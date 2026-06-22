import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking, BookingStatus } from './bookings.schema';
import { PaymentsService } from '../payments/payments.service';
import { UsersService } from '../users/users.service';
import { CreateBookingDto } from './dto/create-booking.dto';

const COMMISSION_RATE = 0.10; // 10%

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private paymentsService: PaymentsService,
    private usersService: UsersService,
  ) {}

  // Seeker creates a booking request
  async create(seekerId: string, dto: CreateBookingDto): Promise<Booking> {
    const professional = await this.usersService.findById(dto.professionalId);
    if (!professional || professional.role !== 'professional') {
      throw new NotFoundException('Professional not found');
    }

    return this.bookingModel.create({
      seekerId: new Types.ObjectId(seekerId),
      professionalId: new Types.ObjectId(dto.professionalId),
      serviceDescription: dto.serviceDescription,
      agreedAmount: dto.agreedAmountNaira * 100, // convert to kobo
      commissionAmount: Math.round(dto.agreedAmountNaira * 100 * COMMISSION_RATE),
      professionalPayout: Math.round(dto.agreedAmountNaira * 100 * (1 - COMMISSION_RATE)),
    });
  }

  // Professional accepts the booking
  async accept(bookingId: string, professionalId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Booking is not pending');
    }
    booking.status = BookingStatus.ACCEPTED;
    return booking.save();
  }

  // Professional starts the job
  async startJob(bookingId: string, professionalId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== BookingStatus.FUNDED) {
      throw new BadRequestException('Job can only be started after payment is confirmed');
    }
    booking.status = BookingStatus.IN_PROGRESS;
    return booking.save();
  }

  // Seeker initiates payment — returns Paystack checkout URL
  async initiateFunding(bookingId: string, seekerId: string): Promise<{ paymentUrl: string; reference: string }> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== BookingStatus.ACCEPTED) {
      throw new BadRequestException('Booking must be accepted before payment');
    }

    const seeker = await this.usersService.findById(seekerId);
    if (!seeker) throw new NotFoundException('Seeker not found');

    const reference = this.paymentsService.generateReference('escrow');

    const transaction = await this.paymentsService.initializeTransaction({
      email: seeker.email,
      amountKobo: booking.agreedAmount,
      reference,
      metadata: { bookingId, seekerId, type: 'escrow_funding' },
    });

    booking.paystackReference = reference;
    await booking.save();

    return { paymentUrl: transaction.authorization_url, reference };
  }

  // Paystack webhook / callback confirms payment
  async confirmFunding(reference: string): Promise<Booking> {
    const booking = await this.bookingModel.findOne({ paystackReference: reference });
    if (!booking) throw new NotFoundException('Booking not found for this reference');
    if (booking.status === BookingStatus.FUNDED) return booking; // idempotent

    await this.paymentsService.verifyTransaction(reference);

    booking.status = BookingStatus.FUNDED;
    booking.fundedAt = new Date();
    return booking.save();
  }

  // Professional marks job as complete
  async markComplete(bookingId: string, professionalId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== BookingStatus.FUNDED && booking.status !== BookingStatus.IN_PROGRESS) {
      throw new BadRequestException('Job is not in a completable state');
    }
    booking.status = BookingStatus.COMPLETED;
    booking.completedAt = new Date();
    return booking.save();
  }

  // Seeker releases funds to professional
  async releaseFunds(bookingId: string, seekerId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('Job must be marked complete first');
    }

    const professional = await this.usersService.findById(booking.professionalId.toString());
    if (!professional?.bankDetails) {
      throw new BadRequestException('Professional has no bank details on file');
    }

    // Create recipient and transfer
    const recipient = await this.paymentsService.createTransferRecipient({
      name: professional.name,
      accountNumber: professional.bankDetails.accountNumber,
      bankCode: professional.bankDetails.bankCode,
    });

    const payoutReference = `payout_${booking._id.toString()}`; // Deterministic reference

    const transfer = await this.paymentsService.initiateTransfer({
    amountKobo: booking.professionalPayout,
    recipientCode: recipient.recipient_code,
    reference: payoutReference, // Safe against retries
    reason: `Swift payout for booking ${bookingId}`,
    });

    booking.status = BookingStatus.RELEASED;
    booking.paystackTransferCode = transfer.transfer_code;
    booking.releasedAt = new Date();
    await booking.save();

    // Update professional stats
    await this.usersService.incrementCompletedJobs(
      booking.professionalId.toString(),
      booking.professionalPayout / 100, // back to naira
    );

    return booking;
  }

  // Seeker raises a dispute
  async raiseDispute(bookingId: string, seekerId: string, reason: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }
    if (![BookingStatus.FUNDED, BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS].includes(booking.status)) {
      throw new BadRequestException('Cannot dispute at this stage');
    }
    booking.status = BookingStatus.DISPUTED;
    booking.disputeReason = reason;
    return booking.save();
  }

  // Admin resolves dispute with refund
  async processRefund(bookingId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.status !== BookingStatus.DISPUTED) {
      throw new BadRequestException('Booking is not in disputed state');
    }
    if (!booking.paystackReference) {
      throw new BadRequestException('No payment reference found');
    }

    const transaction = await this.paymentsService.verifyTransaction(booking.paystackReference);
    await this.paymentsService.refundTransaction(transaction.id, booking.agreedAmount);

    booking.status = BookingStatus.REFUNDED;
    return booking.save();
  }

  async findBySeeker(seekerId: string): Promise<Booking[]> {
    return this.bookingModel
      .find({ seekerId: new Types.ObjectId(seekerId) })
      .populate('professionalId', '-passwordHash')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByProfessional(professionalId: string): Promise<Booking[]> {
    return this.bookingModel
      .find({ professionalId: new Types.ObjectId(professionalId) })
      .populate('seekerId', '-passwordHash')
      .sort({ createdAt: -1 })
      .exec();
  }

  private async findAndValidate(bookingId: string): Promise<Booking> {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking, BookingStatus } from './bookings.schema';
import { PaymentsService } from '../payments/payments.service';
import { UsersService, PUBLIC_USER_PROJECTION } from '../users/users.service';
import { CreateBookingDto } from './dto/create-booking.dto';

const COMMISSION_RATE = 0.10; // 10%
// A /fund claim that never stored its checkout URL (crash mid-initialization)
// can be re-claimed after this long.
const FUNDING_INIT_STALE_MS = 60_000;
const RATEABLE_STATUSES = [BookingStatus.COMPLETED, BookingStatus.RELEASED];

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

    // Round to integer kobo: avoid float artifacts like 0.29 * 100 = 28.9999…
    const agreedAmount = Math.round(dto.agreedAmountNaira * 100);

    return this.bookingModel.create({
      seekerId: new Types.ObjectId(seekerId),
      professionalId: new Types.ObjectId(dto.professionalId),
      serviceDescription: dto.serviceDescription,
      agreedAmount,
      commissionAmount: Math.round(agreedAmount * COMMISSION_RATE),
      professionalPayout: agreedAmount - Math.round(agreedAmount * COMMISSION_RATE),
    });
  }

  // Professional accepts the booking
  async accept(bookingId: string, professionalId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    // Atomic guard: only succeed if the booking is still pending (no read→save race)
    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.PENDING },
        { $set: { status: BookingStatus.ACCEPTED } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException('Booking is not pending');
    }
    return updated;
  }

  // Professional starts the job
  async startJob(bookingId: string, professionalId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    // Atomic guard: only transition if currently FUNDED
    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.FUNDED },
        { $set: { status: BookingStatus.IN_PROGRESS } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException('Job can only be started after payment is confirmed');
    }
    return updated;
  }

  // Seeker initiates payment — returns Paystack checkout URL.
  // Idempotent: repeat calls return the same URL/reference, so a payment made
  // through an earlier URL can never be orphaned by a newer reference.
  async initiateFunding(bookingId: string, seekerId: string): Promise<{ paymentUrl: string; reference: string }> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== BookingStatus.ACCEPTED) {
      throw new BadRequestException('Booking must be accepted before payment');
    }
    if (booking.paystackReference && booking.paystackAuthorizationUrl) {
      return { paymentUrl: booking.paystackAuthorizationUrl, reference: booking.paystackReference };
    }

    const seeker = await this.usersService.findById(seekerId);
    if (!seeker) throw new NotFoundException('Seeker not found');

    const reference = this.paymentsService.generateReference('escrow');

    // Atomic claim: only one concurrent /fund call may initialize a transaction.
    const claimed = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: BookingStatus.ACCEPTED,
          paystackAuthorizationUrl: { $exists: false },
          $or: [
            { paystackReference: { $exists: false } },
            { updatedAt: { $lt: new Date(Date.now() - FUNDING_INIT_STALE_MS) } },
          ],
        },
        { $set: { paystackReference: reference } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      const fresh = await this.findAndValidate(bookingId);
      if (fresh.paystackReference && fresh.paystackAuthorizationUrl) {
        return { paymentUrl: fresh.paystackAuthorizationUrl, reference: fresh.paystackReference };
      }
      if (fresh.status !== BookingStatus.ACCEPTED) {
        throw new BadRequestException('Booking must be accepted before payment');
      }
      throw new ConflictException('Payment is already being initialized, please retry shortly');
    }

    let transaction: { authorization_url: string };
    try {
      transaction = await this.paymentsService.initializeTransaction({
        email: seeker.email,
        amountKobo: booking.agreedAmount,
        reference,
        metadata: { bookingId, seekerId, type: 'escrow_funding' },
      });
    } catch (error) {
      // Release the claim so the seeker can retry.
      await this.bookingModel
        .updateOne(
          { _id: booking._id, paystackReference: reference },
          { $unset: { paystackReference: 1 } },
        )
        .exec();
      throw error;
    }

    await this.bookingModel
      .updateOne(
        { _id: booking._id, paystackReference: reference },
        { $set: { paystackAuthorizationUrl: transaction.authorization_url } },
      )
      .exec();

    return { paymentUrl: transaction.authorization_url, reference };
  }

  // Paystack webhook / callback confirms payment
  async confirmFunding(reference: string): Promise<Booking> {
    const booking = await this.bookingModel.findOne({ paystackReference: reference });
    if (!booking) throw new NotFoundException('Booking not found for this reference');
    if (booking.status === BookingStatus.FUNDED) return booking; // idempotent

    const transaction = await this.paymentsService.verifyTransaction(reference);

    // SECURITY: confirm the amount actually paid matches what the booking
    // expects — otherwise a partial payment could unlock full escrow.
    if (!transaction || typeof transaction.amount !== 'number') {
      throw new BadRequestException('Invalid transaction response from payment provider');
    }
    if (transaction.amount !== booking.agreedAmount) {
      throw new BadRequestException(
        'Payment amount does not match the booking amount',
      );
    }

    // Atomic guard: two concurrent webhooks must not both "fund" the booking.
    const updated = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: { $in: [BookingStatus.ACCEPTED, BookingStatus.PENDING] },
        },
        {
          $set: {
            status: BookingStatus.FUNDED,
            fundedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      // Someone else already transitioned it — treat as already handled.
      const fresh = await this.bookingModel.findById(booking._id).exec();
      return fresh!;
    }
    return updated;
  }

  // Professional marks job as complete
  async markComplete(bookingId: string, professionalId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    // Atomic guard: only transition if currently FUNDED or IN_PROGRESS
    const updated = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: { $in: [BookingStatus.FUNDED, BookingStatus.IN_PROGRESS] },
        },
        {
          $set: {
            status: BookingStatus.COMPLETED,
            completedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException('Job is not in a completable state');
    }
    return updated;
  }

  // Seeker releases funds to professional
  async releaseFunds(bookingId: string, seekerId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }

    // Atomic guard FIRST: claim the transition to RELEASED before touching
    // any money. A concurrent duplicate call now fails here instead of
    // creating a second transfer with the same (deterministic) reference.
    const claimed = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.COMPLETED },
        { $set: { status: BookingStatus.RELEASED, releasedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException('Job must be marked complete first');
    }

    const professional = await this.usersService.findById(booking.professionalId.toString());
    if (!professional?.bankDetails) {
      // Roll the status back so the seeker can retry after the pro adds details.
      await this.bookingModel
        .findByIdAndUpdate(booking._id, {
          $set: { status: BookingStatus.COMPLETED },
          $unset: { releasedAt: 1 },
        })
        .exec();
      throw new BadRequestException('Professional has no bank details on file');
    }

    // Reuse the stored recipient code when possible; Paystack charges for
    // recipient creation, and it is deterministic per bank account.
    let recipientCode: string | undefined = professional.bankDetails?.recipientCode;
    if (!recipientCode) {
      const recipient = await this.paymentsService.createTransferRecipient({
        name: professional.name,
        accountNumber: professional.bankDetails.accountNumber,
        bankCode: professional.bankDetails.bankCode,
      });
      if (!recipient?.recipient_code) {
        throw new BadRequestException('Failed to create Paystack transfer recipient');
      }
      recipientCode = recipient.recipient_code;
      await this.usersService.setTransferRecipient(
        professional._id.toString(),
        recipientCode as string,
      );
    }

    const payoutReference = `payout_${booking._id.toString()}`; // Deterministic reference

    try {
      const transfer = await this.paymentsService.initiateTransfer({
        amountKobo: booking.professionalPayout,
        recipientCode: recipientCode as string,
        reference: payoutReference, // Safe against retries
        reason: `Artiz payout for booking ${bookingId}`,
      });

      await this.bookingModel
        .findByIdAndUpdate(booking._id, {
          $set: { paystackTransferCode: transfer.transfer_code },
        })
        .exec();
    } catch (error) {
      // Transfer failed — roll the status back so it can be retried.
      await this.bookingModel
        .findByIdAndUpdate(booking._id, {
          $set: { status: BookingStatus.COMPLETED },
          $unset: { releasedAt: 1 },
        })
        .exec();
      throw error;
    }

    // Update professional stats
    await this.usersService.incrementCompletedJobs(
      booking.professionalId.toString(),
      booking.professionalPayout / 100, // back to naira
    );

    return this.bookingModel.findById(booking._id).exec().then((b) => b!);
  }

  // Seeker raises a dispute
  async raiseDispute(bookingId: string, seekerId: string, reason: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }
    // Atomic guard: only disputable from these three states
    const updated = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: {
            $in: [
              BookingStatus.FUNDED,
              BookingStatus.COMPLETED,
              BookingStatus.IN_PROGRESS,
            ],
          },
        },
        {
          $set: {
            status: BookingStatus.DISPUTED,
            disputeReason: reason,
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException('Cannot dispute at this stage');
    }
    return updated;
  }

  // Admin resolves dispute with refund
  async processRefund(bookingId: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (!booking.paystackReference) {
      throw new BadRequestException('No payment reference found');
    }

    // Atomically claim the transition to REFUNDED before contacting Paystack.
    const claimed = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.DISPUTED },
        { $set: { status: BookingStatus.REFUNDED } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException('Booking is not in disputed state');
    }

    const transaction = await this.paymentsService.verifyTransaction(booking.paystackReference);
    await this.paymentsService.refundTransaction(transaction.id, booking.agreedAmount);

    return claimed;
  }

  // Seeker rates the professional — at most once per completed booking
  async rate(bookingId: string, seekerId: string, rating: number): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }

    // Atomic claim: concurrent requests cannot both rate the same booking.
    const claimed = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: { $in: RATEABLE_STATUSES },
          rating: { $exists: false },
        },
        { $set: { rating, ratedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException(
        booking.rating !== undefined
          ? 'This booking has already been rated'
          : 'Only completed bookings can be rated',
      );
    }

    try {
      await this.usersService.addRating(booking.professionalId.toString(), rating);
    } catch (error) {
      // Undo the claim so the rating can be retried.
      await this.bookingModel
        .updateOne({ _id: booking._id }, { $unset: { rating: 1, ratedAt: 1 } })
        .exec();
      throw error;
    }
    return claimed;
  }

  async findBySeeker(seekerId: string): Promise<Booking[]> {
    return this.bookingModel
      .find({ seekerId: new Types.ObjectId(seekerId) })
      .populate('professionalId', PUBLIC_USER_PROJECTION)
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByProfessional(professionalId: string): Promise<Booking[]> {
    return this.bookingModel
      .find({ professionalId: new Types.ObjectId(professionalId) })
      .populate('seekerId', PUBLIC_USER_PROJECTION)
      .sort({ createdAt: -1 })
      .exec();
  }

  private async findAndValidate(bookingId: string): Promise<Booking> {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}
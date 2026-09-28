import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
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
// Bookings can be cancelled/declined only before money is involved.
const CANCELLABLE_STATUSES = [BookingStatus.PENDING, BookingStatus.ACCEPTED];
// Admins may see contact details (phone) to mediate disputes, never bank details.
const ADMIN_USER_PROJECTION = '-passwordHash -bankDetails';

export type DisputeOutcome = 'refund' | 'release';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private paymentsService: PaymentsService,
    private usersService: UsersService,
  ) {}

  // Seeker creates a booking request
  async create(seekerId: string, dto: CreateBookingDto, role?: string): Promise<Booking> {
    // Bookings are listed per side (seeker vs professional), so only customer
    // accounts may create them.
    if (role !== 'seeker') {
      throw new ForbiddenException('Only customer accounts can book professionals');
    }
    if (dto.professionalId === seekerId) {
      throw new BadRequestException("You can't book yourself");
    }
    const professional = await this.usersService.findById(dto.professionalId);
    if (!professional || professional.role !== 'professional') {
      throw new NotFoundException('Professional not found');
    }
    // Same rule as the marketplace search: active, email-verified professionals only
    if (!professional.isActive || !professional.isVerified) {
      throw new BadRequestException("This professional isn't accepting bookings right now");
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
      const fresh = await this.bookingModel.findById(booking._id).exec();
      if (fresh?.status === BookingStatus.CANCELLED) {
        // Paid through a checkout link after the booking was cancelled.
        return this.refundCancelledPayment(fresh, transaction.id);
      }
      // Someone else already transitioned it — treat as already handled.
      return fresh!;
    }
    return updated;
  }

  // Money arrived for a cancelled booking: send it straight back.
  // Throws on failure so the webhook returns non-2xx and Paystack retries.
  private async refundCancelledPayment(booking: Booking, transactionId: string): Promise<Booking> {
    const claimed = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.CANCELLED },
        { $set: { status: BookingStatus.REFUNDED } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      return (await this.bookingModel.findById(booking._id).exec())!;
    }
    try {
      await this.paymentsService.refundTransaction(transactionId, booking.agreedAmount);
    } catch (error) {
      await this.bookingModel
        .updateOne({ _id: booking._id }, { $set: { status: BookingStatus.CANCELLED } })
        .exec();
      this.logger.error(`Auto-refund failed for cancelled booking ${booking._id.toString()}`);
      throw error;
    }
    this.logger.warn(`Refunded payment received for cancelled booking ${booking._id.toString()}`);
    return claimed;
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
        { $set: { status: BookingStatus.RELEASED, releasedAt: new Date() }, $inc: { payoutAttempts: 1 } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException('Job must be marked complete first');
    }

    await this.payOutProfessional(
      booking,
      { $set: { status: BookingStatus.COMPLETED }, $unset: { releasedAt: 1 } },
      claimed.payoutAttempts,
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

  // Seeker cancels before funding
  async cancel(bookingId: string, seekerId: string, reason?: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.seekerId.toString() !== seekerId) {
      throw new ForbiddenException('Not your booking');
    }
    return this.cancelBeforeFunding(booking, 'seeker', reason);
  }

  // Professional declines (or withdraws) before funding
  async decline(bookingId: string, professionalId: string, reason?: string): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (booking.professionalId.toString() !== professionalId) {
      throw new ForbiddenException('Not your booking');
    }
    return this.cancelBeforeFunding(booking, 'professional', reason);
  }

  private async cancelBeforeFunding(
    booking: Booking,
    cancelledBy: 'seeker' | 'professional',
    reason?: string,
  ): Promise<Booking> {
    // If the seeker still pays an outstanding checkout link, confirmFunding
    // sees CANCELLED and refunds automatically.
    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: { $in: CANCELLABLE_STATUSES } },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelledBy,
            cancelledAt: new Date(),
            ...(reason ? { cancellationReason: reason } : {}),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException('Only pending or accepted bookings can be cancelled');
    }
    return updated;
  }

  // Admin resolves a dispute: refund the seeker or release funds to the professional
  async resolveDispute(bookingId: string, adminId: string, outcome: DisputeOutcome): Promise<Booking> {
    const booking = await this.findAndValidate(bookingId);
    if (outcome === 'refund' && !booking.paystackReference) {
      throw new BadRequestException('No payment reference found');
    }

    const resolution = {
      disputeResolution: outcome,
      resolvedBy: new Types.ObjectId(adminId),
      resolvedAt: new Date(),
    };
    const rollback = {
      $set: { status: BookingStatus.DISPUTED },
      $unset: { disputeResolution: 1, resolvedBy: 1, resolvedAt: 1, releasedAt: 1 },
    };

    // Atomically claim the final state before contacting Paystack.
    const claimed = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.DISPUTED },
        {
          $set: {
            ...resolution,
            ...(outcome === 'refund'
              ? { status: BookingStatus.REFUNDED }
              : { status: BookingStatus.RELEASED, releasedAt: new Date() }),
          },
          ...(outcome === 'release' ? { $inc: { payoutAttempts: 1 } } : {}),
        },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException('Booking is not in disputed state');
    }

    if (outcome === 'release') {
      await this.payOutProfessional(booking, rollback, claimed.payoutAttempts);
    } else {
      try {
        const transaction = await this.paymentsService.verifyTransaction(booking.paystackReference!);
        await this.paymentsService.refundTransaction(transaction.id, booking.agreedAmount);
      } catch (error) {
        await this.bookingModel.findByIdAndUpdate(booking._id, rollback).exec();
        throw error;
      }
    }
    return this.bookingModel.findById(booking._id).exec().then((b) => b!);
  }

  // Transfers professionalPayout to the pro's bank account and updates their stats.
  // The caller must already have claimed the RELEASED status; on any failure
  // before the transfer succeeds, `rollback` is applied and the error rethrown.
  private async payOutProfessional(
    booking: Booking,
    rollback: Record<string, unknown>,
    attempt = 1,
  ): Promise<void> {
    try {
      const professional = await this.usersService.findById(booking.professionalId.toString());
      if (!professional?.bankDetails) {
        throw new BadRequestException('Professional has no bank details on file');
      }

      // Reuse the stored recipient code when possible; Paystack charges for
      // recipient creation, and it is deterministic per bank account.
      let recipientCode: string | undefined = professional.bankDetails.recipientCode;
      if (!recipientCode) {
        const recipient = await this.paymentsService.createTransferRecipient({
          name: professional.name,
          accountNumber: professional.bankDetails.accountNumber,
          bankCode: professional.bankDetails.bankCode,
        });
        if (!recipient?.recipient_code) {
          throw new BadRequestException('Failed to create Paystack transfer recipient');
        }
        recipientCode = recipient.recipient_code as string;
        await this.usersService.setTransferRecipient(professional._id.toString(), recipientCode);
      }

      const transfer = await this.paymentsService.initiateTransfer({
        amountKobo: booking.professionalPayout,
        recipientCode,
        // Deterministic per attempt: a duplicate call can't pay twice, while a
        // retry after a failed payout gets a reference Paystack hasn't seen.
        reference: attempt > 1 ? `payout_${booking._id.toString()}_${attempt}` : `payout_${booking._id.toString()}`,
        reason: `Artiz payout for booking ${booking._id.toString()}`,
      });

      await this.bookingModel
        .findByIdAndUpdate(booking._id, {
          $set: {
            paystackTransferCode: transfer.transfer_code,
            payoutStatus: transfer.status === 'success' ? 'paid' : 'pending',
          },
          $unset: { payoutFailureReason: 1 },
        })
        .exec();
    } catch (error) {
      await this.bookingModel.findByIdAndUpdate(booking._id, rollback).exec();
      throw error;
    }

    await this.usersService.incrementCompletedJobs(
      booking.professionalId.toString(),
      booking.professionalPayout / 100, // back to naira
    );
  }

  // Paystack's transfer.* webhooks: the final word on whether a payout arrived.
  // Idempotent (Paystack retries), and a stale event for an older attempt
  // can't touch the booking because it's matched by the current transfer code.
  async handleTransferEvent(
    event: 'transfer.success' | 'transfer.failed' | 'transfer.reversed',
    data: { reference?: string; transfer_code?: string; reason?: string },
  ): Promise<void> {
    let target: Record<string, unknown>;
    if (data.transfer_code) {
      target = { paystackTransferCode: data.transfer_code };
    } else {
      const m = /^payout_([a-f0-9]{24})(?:_\d+)?$/.exec(data.reference ?? '');
      if (!m) return; // not one of our payouts
      target = { _id: m[1] };
    }

    if (event === 'transfer.success') {
      await this.bookingModel
        .findOneAndUpdate({ ...target, status: BookingStatus.RELEASED }, { $set: { payoutStatus: 'paid' } })
        .exec();
      return;
    }

    const reason =
      data.reason ||
      (event === 'transfer.reversed' ? 'The bank reversed the payout.' : 'The bank transfer failed.');
    // An admin-resolved dispute goes back to the admin; a customer release
    // goes back to "awaiting release" so it can be retried.
    const reverted =
      (await this.bookingModel
        .findOneAndUpdate(
          { ...target, status: BookingStatus.RELEASED, disputeResolution: 'release' },
          {
            $set: { status: BookingStatus.DISPUTED, payoutStatus: 'failed', payoutFailureReason: reason },
            $unset: { disputeResolution: 1, resolvedBy: 1, resolvedAt: 1, releasedAt: 1 },
          },
          { new: true },
        )
        .exec()) ??
      (await this.bookingModel
        .findOneAndUpdate(
          { ...target, status: BookingStatus.RELEASED },
          {
            $set: { status: BookingStatus.COMPLETED, payoutStatus: 'failed', payoutFailureReason: reason },
            $unset: { releasedAt: 1 },
          },
          { new: true },
        )
        .exec());
    if (!reverted) return; // already handled, or not a released booking

    await this.usersService.revertCompletedJob(
      reverted.professionalId.toString(),
      reverted.professionalPayout / 100,
    );
    this.logger.warn(`Payout failed for booking ${reverted._id.toString()}: ${reason}`);
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

  // Single booking for a participant (or an admin), with both parties populated
  async findOneForUser(bookingId: string, userId: string, role: string): Promise<Booking> {
    const isAdmin = role === 'admin';
    const projection = isAdmin ? ADMIN_USER_PROJECTION : PUBLIC_USER_PROJECTION;
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('seekerId', projection)
      .populate('professionalId', projection)
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');

    const isParticipant = [booking.seekerId, booking.professionalId].some(
      (party) => party?._id?.toString() === userId,
    );
    if (!isParticipant && !isAdmin) {
      throw new ForbiddenException('Not your booking');
    }
    return booking;
  }

  // Admin queue: disputed bookings, oldest first
  async findDisputed(): Promise<Booking[]> {
    return this.bookingModel
      .find({ status: BookingStatus.DISPUTED })
      .populate('seekerId', ADMIN_USER_PROJECTION)
      .populate('professionalId', ADMIN_USER_PROJECTION)
      .sort({ updatedAt: 1 })
      .exec();
  }

  private async findAndValidate(bookingId: string): Promise<Booking> {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './bookings.schema';
import { PaymentsService } from '../payments/payments.service';
import { UsersService } from '../users/users.service';

const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });

// A mongoose-like query: awaitable directly, via .exec(), and chainable with .populate()
interface MockQuery extends PromiseLike<unknown> {
  exec: jest.Mock;
  populate: jest.Mock;
}
const query = (value: unknown): MockQuery => {
  const q: MockQuery = {
    exec: jest.fn().mockResolvedValue(value),
    populate: jest.fn(() => q),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
};

describe('BookingsService', () => {
  let service: BookingsService;
  let bookingModel: Record<string, jest.Mock>;
  let paymentsService: Record<string, jest.Mock>;
  let usersService: Record<string, jest.Mock>;

  const seekerId = new Types.ObjectId().toString();
  const professionalId = new Types.ObjectId().toString();
  const bookingId = new Types.ObjectId().toString();

  const makeBooking = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(bookingId),
    seekerId: new Types.ObjectId(seekerId),
    professionalId: new Types.ObjectId(professionalId),
    agreedAmount: 500_000,
    status: BookingStatus.ACCEPTED,
    ...overrides,
  });

  beforeEach(async () => {
    bookingModel = {
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue(exec({})),
      findByIdAndUpdate: jest.fn().mockReturnValue(exec({})),
    };
    paymentsService = {
      generateReference: jest.fn().mockReturnValue('escrow_new'),
      initializeTransaction: jest
        .fn()
        .mockResolvedValue({ authorization_url: 'https://pay/new' }),
      verifyTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'trx_1', amount: 500_000 }),
      refundTransaction: jest.fn().mockResolvedValue({}),
      createTransferRecipient: jest
        .fn()
        .mockResolvedValue({ recipient_code: 'RCP_1' }),
      initiateTransfer: jest.fn().mockResolvedValue({ transfer_code: 'TRF_1' }),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({ email: 'seeker@test.com' }),
      addRating: jest.fn().mockResolvedValue({}),
      setTransferRecipient: jest.fn().mockResolvedValue(undefined),
      incrementCompletedJobs: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getModelToken('Booking'), useValue: bookingModel },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  describe('initiateFunding', () => {
    it('returns the existing checkout URL instead of creating a new reference', async () => {
      bookingModel.findById.mockResolvedValue(
        makeBooking({
          paystackReference: 'escrow_old',
          paystackAuthorizationUrl: 'https://pay/old',
        }),
      );

      await expect(
        service.initiateFunding(bookingId, seekerId),
      ).resolves.toEqual({
        paymentUrl: 'https://pay/old',
        reference: 'escrow_old',
      });
      expect(paymentsService.initializeTransaction).not.toHaveBeenCalled();
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('claims, initializes and stores the checkout URL on first call', async () => {
      bookingModel.findById.mockResolvedValue(makeBooking());
      bookingModel.findOneAndUpdate.mockReturnValue(
        exec(makeBooking({ paystackReference: 'escrow_new' })),
      );

      await expect(
        service.initiateFunding(bookingId, seekerId),
      ).resolves.toEqual({
        paymentUrl: 'https://pay/new',
        reference: 'escrow_new',
      });
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ paystackReference: 'escrow_new' }),
        { $set: { paystackAuthorizationUrl: 'https://pay/new' } },
      );
    });

    it('returns 409 while another call holds the claim', async () => {
      bookingModel.findById
        .mockResolvedValueOnce(makeBooking())
        .mockResolvedValueOnce(
          makeBooking({ paystackReference: 'escrow_other' }),
        );
      bookingModel.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(
        service.initiateFunding(bookingId, seekerId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(paymentsService.initializeTransaction).not.toHaveBeenCalled();
    });

    it('releases the claim when Paystack initialization fails', async () => {
      bookingModel.findById.mockResolvedValue(makeBooking());
      bookingModel.findOneAndUpdate.mockReturnValue(
        exec(makeBooking({ paystackReference: 'escrow_new' })),
      );
      paymentsService.initializeTransaction.mockRejectedValue(
        new Error('paystack down'),
      );

      await expect(
        service.initiateFunding(bookingId, seekerId),
      ).rejects.toThrow('paystack down');
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ paystackReference: 'escrow_new' }),
        { $unset: { paystackReference: 1 } },
      );
    });
  });

  describe('rate', () => {
    it('rejects callers who are not the seeker', async () => {
      bookingModel.findById.mockResolvedValue(
        makeBooking({ status: BookingStatus.COMPLETED }),
      );

      await expect(
        service.rate(bookingId, new Types.ObjectId().toString(), 5),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(usersService.addRating).not.toHaveBeenCalled();
    });

    it('rates the professional once for a completed booking', async () => {
      bookingModel.findById.mockResolvedValue(
        makeBooking({ status: BookingStatus.COMPLETED }),
      );
      bookingModel.findOneAndUpdate.mockReturnValue(
        exec(makeBooking({ rating: 4 })),
      );

      await service.rate(bookingId, seekerId, 4);
      expect(usersService.addRating).toHaveBeenCalledWith(professionalId, 4);
    });

    it('rejects a second rating for the same booking', async () => {
      bookingModel.findById.mockResolvedValue(
        makeBooking({ status: BookingStatus.RELEASED, rating: 5 }),
      );
      bookingModel.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(service.rate(bookingId, seekerId, 1)).rejects.toThrow(
        'already been rated',
      );
      expect(usersService.addRating).not.toHaveBeenCalled();
    });

    it('rejects rating a booking that is not completed', async () => {
      bookingModel.findById.mockResolvedValue(
        makeBooking({ status: BookingStatus.FUNDED }),
      );
      bookingModel.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(service.rate(bookingId, seekerId, 5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('undoes the claim if updating the provider fails', async () => {
      bookingModel.findById.mockResolvedValue(
        makeBooking({ status: BookingStatus.COMPLETED }),
      );
      bookingModel.findOneAndUpdate.mockReturnValue(
        exec(makeBooking({ rating: 3 })),
      );
      usersService.addRating.mockRejectedValue(
        new BadRequestException('conflict'),
      );

      await expect(service.rate(bookingId, seekerId, 3)).rejects.toThrow(
        'conflict',
      );
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $unset: { rating: 1, ratedAt: 1 } },
      );
    });
  });

  describe('cancel / decline', () => {
    it('lets the seeker cancel an accepted booking', async () => {
      bookingModel.findById.mockReturnValue(query(makeBooking()));
      bookingModel.findOneAndUpdate.mockReturnValue(
        exec(makeBooking({ status: BookingStatus.CANCELLED })),
      );

      await service.cancel(bookingId, seekerId, 'changed my mind');
      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: [BookingStatus.PENDING, BookingStatus.ACCEPTED] },
        }),
        {
          $set: expect.objectContaining({
            status: BookingStatus.CANCELLED,
            cancelledBy: 'seeker',
            cancellationReason: 'changed my mind',
          }),
        },
        { new: true },
      );
    });

    it('does not let the professional use the seeker cancel', async () => {
      bookingModel.findById.mockReturnValue(query(makeBooking()));
      await expect(
        service.cancel(bookingId, professionalId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects declining a funded booking', async () => {
      bookingModel.findById.mockReturnValue(
        query(makeBooking({ status: BookingStatus.FUNDED })),
      );
      bookingModel.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(
        service.decline(bookingId, professionalId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirmFunding', () => {
    it('refunds a payment that arrives after the booking was cancelled', async () => {
      const cancelled = makeBooking({
        status: BookingStatus.CANCELLED,
        paystackReference: 'escrow_old',
      });
      bookingModel.findOne = jest.fn().mockResolvedValue(cancelled);
      bookingModel.findOneAndUpdate
        .mockReturnValueOnce(exec(null)) // funding claim fails: not accepted
        .mockReturnValueOnce(
          exec({ ...cancelled, status: BookingStatus.REFUNDED }),
        );
      bookingModel.findById.mockReturnValue(query(cancelled));

      const result = await service.confirmFunding('escrow_old');
      expect(paymentsService.refundTransaction).toHaveBeenCalledWith(
        'trx_1',
        500_000,
      );
      expect(result.status).toBe(BookingStatus.REFUNDED);
    });
  });

  describe('resolveDispute', () => {
    const adminId = new Types.ObjectId().toString();
    const disputed = () =>
      makeBooking({
        status: BookingStatus.DISPUTED,
        paystackReference: 'escrow_1',
        professionalPayout: 450_000,
      });

    it('refunds the seeker', async () => {
      bookingModel.findById.mockReturnValue(query(disputed()));
      bookingModel.findOneAndUpdate.mockReturnValue(exec(disputed()));

      await service.resolveDispute(bookingId, adminId, 'refund');
      expect(paymentsService.refundTransaction).toHaveBeenCalledWith(
        'trx_1',
        500_000,
      );
      expect(paymentsService.initiateTransfer).not.toHaveBeenCalled();
    });

    it('releases funds to the professional', async () => {
      bookingModel.findById.mockReturnValue(query(disputed()));
      bookingModel.findOneAndUpdate.mockReturnValue(exec(disputed()));
      usersService.findById.mockResolvedValue({
        _id: new Types.ObjectId(professionalId),
        name: 'Pro',
        bankDetails: {
          accountNumber: '0123456789',
          bankCode: '058',
          bankName: 'GTB',
        },
      });

      await service.resolveDispute(bookingId, adminId, 'release');
      expect(paymentsService.initiateTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amountKobo: 450_000,
          reference: `payout_${bookingId}`,
        }),
      );
      expect(usersService.incrementCompletedJobs).toHaveBeenCalledWith(
        professionalId,
        4500,
      );
    });

    it('rolls back to disputed when the payout fails', async () => {
      bookingModel.findById.mockReturnValue(query(disputed()));
      bookingModel.findOneAndUpdate.mockReturnValue(exec(disputed()));
      usersService.findById.mockResolvedValue({
        _id: new Types.ObjectId(professionalId),
        name: 'Pro',
        bankDetails: {
          accountNumber: '0123456789',
          bankCode: '058',
          bankName: 'GTB',
        },
      });
      paymentsService.createTransferRecipient.mockRejectedValue(
        new Error('paystack down'),
      );

      await expect(
        service.resolveDispute(bookingId, adminId, 'release'),
      ).rejects.toThrow('paystack down');
      expect(bookingModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: { status: BookingStatus.DISPUTED } }),
      );
      expect(usersService.incrementCompletedJobs).not.toHaveBeenCalled();
    });
  });

  describe('findOneForUser', () => {
    const populated = () =>
      makeBooking({
        seekerId: { _id: new Types.ObjectId(seekerId) },
        professionalId: { _id: new Types.ObjectId(professionalId) },
      });

    it('returns the booking to a participant', async () => {
      bookingModel.findById.mockReturnValue(query(populated()));
      await expect(
        service.findOneForUser(bookingId, professionalId, 'professional'),
      ).resolves.toBeDefined();
    });

    it('rejects other users', async () => {
      bookingModel.findById.mockReturnValue(query(populated()));
      await expect(
        service.findOneForUser(
          bookingId,
          new Types.ObjectId().toString(),
          'seeker',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows admins', async () => {
      bookingModel.findById.mockReturnValue(query(populated()));
      await expect(
        service.findOneForUser(
          bookingId,
          new Types.ObjectId().toString(),
          'admin',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('create', () => {
    const dto = { professionalId, serviceDescription: 'Fix the kitchen sink', agreedAmountNaira: 5000 };
    const pro = (o: Record<string, unknown> = {}) => ({
      _id: new Types.ObjectId(professionalId),
      role: 'professional',
      isActive: true,
      isVerified: true,
      ...o,
    });

    beforeEach(() => {
      bookingModel.create = jest.fn().mockImplementation((doc: unknown) => Promise.resolve(doc));
    });

    it('creates a pending booking with the 10% split in kobo', async () => {
      usersService.findById.mockResolvedValue(pro());
      const b = (await service.create(seekerId, dto, 'seeker')) as unknown as Record<string, number>;
      expect(b.agreedAmount).toBe(500_000);
      expect(b.commissionAmount).toBe(50_000);
      expect(b.professionalPayout).toBe(450_000);
    });

    it('only customer accounts can book', async () => {
      usersService.findById.mockResolvedValue(pro());
      await expect(service.create(seekerId, dto, 'professional')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.create(seekerId, dto, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
      expect(bookingModel.create).not.toHaveBeenCalled();
    });

    it("can't book yourself", async () => {
      await expect(
        service.create(professionalId, { ...dto, professionalId }, 'seeker'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['deactivated', { isActive: false }],
      ['email not verified', { isVerified: false }],
    ])('rejects a professional who is %s', async (_label, o) => {
      usersService.findById.mockResolvedValue(pro(o));
      await expect(service.create(seekerId, dto, 'seeker')).rejects.toBeInstanceOf(BadRequestException);
      expect(bookingModel.create).not.toHaveBeenCalled();
    });

    it('404s for a user who is not a professional', async () => {
      usersService.findById.mockResolvedValue(pro({ role: 'seeker' }));
      await expect(service.create(seekerId, dto, 'seeker')).rejects.toThrow('Professional not found');
    });
  });

  describe('payouts', () => {
    const withBank = {
      _id: new Types.ObjectId(professionalId),
      name: 'Pro',
      bankDetails: { accountNumber: '0123456789', bankCode: '058', bankName: 'GTB', recipientCode: 'RCP_1' },
    };
    const completed = (o: Record<string, unknown> = {}) =>
      makeBooking({ status: BookingStatus.COMPLETED, professionalPayout: 450_000, ...o });

    beforeEach(() => {
      usersService.findById.mockResolvedValue(withBank);
      usersService.revertCompletedJob = jest.fn().mockResolvedValue({});
    });

    it('first release uses payout_<id>; a retry gets a fresh reference', async () => {
      bookingModel.findById.mockReturnValue(query(completed()));
      bookingModel.findOneAndUpdate.mockReturnValueOnce(exec(completed({ payoutAttempts: 1 })));
      await service.releaseFunds(bookingId, seekerId);
      expect(paymentsService.initiateTransfer.mock.calls[0][0].reference).toBe(`payout_${bookingId}`);

      bookingModel.findOneAndUpdate.mockReturnValueOnce(exec(completed({ payoutAttempts: 2 })));
      await service.releaseFunds(bookingId, seekerId);
      expect(paymentsService.initiateTransfer.mock.calls[1][0].reference).toBe(`payout_${bookingId}_2`);

      // the claim counts the attempt atomically
      expect(bookingModel.findOneAndUpdate.mock.calls[0][1]).toMatchObject({ $inc: { payoutAttempts: 1 } });
    });

    it('records the payout as pending until Paystack confirms it', async () => {
      bookingModel.findById.mockReturnValue(query(completed()));
      bookingModel.findOneAndUpdate.mockReturnValueOnce(exec(completed({ payoutAttempts: 1 })));
      await service.releaseFunds(bookingId, seekerId);
      const saved = bookingModel.findByIdAndUpdate.mock.calls.find((c) => c[1]?.$set?.paystackTransferCode);
      expect(saved?.[1].$set).toMatchObject({ paystackTransferCode: 'TRF_1', payoutStatus: 'pending' });
    });

    it('transfer.success marks the payout paid', async () => {
      bookingModel.findOneAndUpdate.mockReturnValueOnce(exec(makeBooking({ status: BookingStatus.RELEASED })));
      await service.handleTransferEvent('transfer.success', { transfer_code: 'TRF_1', reference: `payout_${bookingId}` });
      const [filter, update] = bookingModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({ paystackTransferCode: 'TRF_1', status: BookingStatus.RELEASED });
      expect(update).toEqual({ $set: { payoutStatus: 'paid' } });
    });

    it('transfer.failed puts a customer release back to "awaiting release" and reverses stats', async () => {
      bookingModel.findOneAndUpdate
        .mockReturnValueOnce(exec(null)) // not an admin dispute release
        .mockReturnValueOnce(exec(makeBooking({ status: BookingStatus.COMPLETED, professionalPayout: 450_000 })));
      await service.handleTransferEvent('transfer.failed', { transfer_code: 'TRF_1', reason: 'Account closed' });
      const [filter, update] = bookingModel.findOneAndUpdate.mock.calls[1];
      expect(filter).toMatchObject({ paystackTransferCode: 'TRF_1', status: BookingStatus.RELEASED });
      expect(update.$set).toMatchObject({
        status: BookingStatus.COMPLETED,
        payoutStatus: 'failed',
        payoutFailureReason: 'Account closed',
      });
      expect(usersService.revertCompletedJob).toHaveBeenCalledWith(professionalId, 4500);
    });

    it('transfer.reversed on an admin release puts the booking back in dispute', async () => {
      bookingModel.findOneAndUpdate.mockReturnValueOnce(
        exec(makeBooking({ status: BookingStatus.DISPUTED, professionalPayout: 450_000 })),
      );
      await service.handleTransferEvent('transfer.reversed', { transfer_code: 'TRF_1' });
      const [filter, update] = bookingModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({ disputeResolution: 'release' });
      expect(update.$set.status).toBe(BookingStatus.DISPUTED);
      expect(update.$unset).toMatchObject({ disputeResolution: 1, resolvedBy: 1, resolvedAt: 1 });
      expect(usersService.revertCompletedJob).toHaveBeenCalled();
    });

    it('a repeated failure event changes nothing (Paystack retries webhooks)', async () => {
      bookingModel.findOneAndUpdate.mockReturnValue(exec(null));
      await service.handleTransferEvent('transfer.failed', { transfer_code: 'TRF_1' });
      expect(usersService.revertCompletedJob).not.toHaveBeenCalled();
    });

    it('falls back to the payout reference when there is no transfer code', async () => {
      bookingModel.findOneAndUpdate.mockReturnValue(exec(null));
      await service.handleTransferEvent('transfer.success', { reference: `payout_${bookingId}_3` });
      expect(bookingModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: bookingId });
      await service.handleTransferEvent('transfer.success', { reference: 'escrow_123' });
      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledTimes(1); // unrelated reference ignored
    });
  });
});

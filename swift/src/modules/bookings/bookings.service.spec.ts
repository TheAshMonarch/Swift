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
    };
    paymentsService = {
      generateReference: jest.fn().mockReturnValue('escrow_new'),
      initializeTransaction: jest
        .fn()
        .mockResolvedValue({ authorization_url: 'https://pay/new' }),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({ email: 'seeker@test.com' }),
      addRating: jest.fn().mockResolvedValue({}),
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
});

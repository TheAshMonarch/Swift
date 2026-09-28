import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { BadGatewayException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

describe('PaymentsService.getBanks', () => {
  let service: PaymentsService;

  beforeEach(() => {
    mockedGet.mockReset();
    service = new PaymentsService({
      get: () => 'sk_test',
    } as unknown as ConfigService);
  });

  it('follows cursor pages, drops inactive banks, sorts by name and caches', async () => {
    mockedGet
      .mockResolvedValueOnce({
        data: {
          data: [
            { name: 'Zenith Bank', code: '057' },
            { name: 'Old Bank', code: '000', active: false },
          ],
          meta: { next: 'cursor2' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ name: 'Access Bank', code: '044' }],
          meta: { next: null },
        },
      });

    const banks = await service.getBanks();
    expect(banks).toEqual([
      { name: 'Access Bank', code: '044' },
      { name: 'Zenith Bank', code: '057' },
    ]);
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet.mock.calls[1][1].params).toMatchObject({
      next: 'cursor2',
    });

    await service.getBanks();
    expect(mockedGet).toHaveBeenCalledTimes(2); // served from cache
  });

  it('does not cache a failed fetch', async () => {
    mockedGet.mockRejectedValueOnce(new Error('paystack down'));
    await expect(service.getBanks()).rejects.toBeInstanceOf(BadGatewayException);

    mockedGet.mockResolvedValueOnce({
      data: { data: [{ name: 'GTBank', code: '058' }] },
    });
    await expect(service.getBanks()).resolves.toEqual([
      { name: 'GTBank', code: '058' },
    ]);
  });
});

describe('PaymentsService callback URL', () => {
  const make = (env: Record<string, string | undefined>) =>
    new PaymentsService({ get: (k: string) => env[k] } as unknown as ConfigService);

  it('uses a valid PAYSTACK_CALLBACK_URL as-is', () => {
    expect(make({ PAYSTACK_CALLBACK_URL: 'https://app.example.com/pay/done' }).callbackUrl).toBe(
      'https://app.example.com/pay/done',
    );
  });

  it('falls back to FRONTEND_URL when the configured value is malformed', () => {
    const svc = make({
      PAYSTACK_CALLBACK_URL: 'PAYSTACK_CALLBACK_URL=https://old.ngrok.dev/x',
      FRONTEND_URL: 'https://artiz.example.com',
    });
    expect(svc.callbackUrl).toBe('https://artiz.example.com/dashboard/bookings/payment-callback');
  });

  it('falls back to FRONTEND_URL when unset', () => {
    expect(make({ FRONTEND_URL: 'https://artiz.example.com/' }).callbackUrl).toBe(
      'https://artiz.example.com/dashboard/bookings/payment-callback',
    );
  });

  it('is undefined when nothing usable is configured', () => {
    expect(make({}).callbackUrl).toBeUndefined();
  });
});

describe('PaymentsService Paystack errors', () => {
  const mockedPost = axios.post as jest.Mock;
  const svc = () =>
    new PaymentsService({ get: () => 'sk_test' } as unknown as ConfigService);
  const paystackError = (status: number, message: string) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data: { status: false, message } },
    });

  beforeEach(() => mockedPost.mockReset());

  it("surfaces Paystack's own message as a 502 instead of a bare 500", async () => {
    mockedPost.mockRejectedValueOnce(
      paystackError(400, 'You cannot initiate third party payouts as a starter business'),
    );
    const err = await svc()
      .initiateTransfer({ amountKobo: 1000, recipientCode: 'R', reference: 'x', reason: 'r' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as BadGatewayException).message).toContain(
      'You cannot initiate third party payouts as a starter business',
    );
  });

  it('treats a transfer held for OTP as a failure (no money moved)', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { status: true, data: { status: 'otp', transfer_code: 'TRF_1' } },
    });
    await expect(
      svc().initiateTransfer({ amountKobo: 1000, recipientCode: 'R', reference: 'x', reason: 'r' }),
    ).rejects.toThrow(/OTP/);
  });

  it('passes through a successful transfer', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { status: true, data: { status: 'pending', transfer_code: 'TRF_2' } },
    });
    await expect(
      svc().initiateTransfer({ amountKobo: 1000, recipientCode: 'R', reference: 'x', reason: 'r' }),
    ).resolves.toMatchObject({ transfer_code: 'TRF_2' });
  });

  it('reports network failures without a Paystack response', async () => {
    mockedPost.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.paystack.co'));
    await expect(
      svc().createTransferRecipient({ name: 'A', accountNumber: '0123456789', bankCode: '058' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

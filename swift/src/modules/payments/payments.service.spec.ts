import axios from 'axios';
import { ConfigService } from '@nestjs/config';
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
    await expect(service.getBanks()).rejects.toThrow('paystack down');

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

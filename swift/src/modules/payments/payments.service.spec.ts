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

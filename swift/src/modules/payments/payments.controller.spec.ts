import { PaymentsController } from './payments.controller';

describe('PaymentsController webhook routing', () => {
  const payments = { verifyWebhookSignature: jest.fn().mockReturnValue(true) };
  const bookings = { confirmFunding: jest.fn(), handleTransferEvent: jest.fn() };
  const controller = new PaymentsController(payments as never, bookings as never);
  const send = (event: string, data: Record<string, unknown>) =>
    controller.handleWebhook('sig', { rawBody: Buffer.from(JSON.stringify({ event, data })) } as never);

  beforeEach(() => jest.clearAllMocks());

  it('confirms funding on charge.success', async () => {
    await send('charge.success', { reference: 'escrow_1' });
    expect(bookings.confirmFunding).toHaveBeenCalledWith('escrow_1');
  });

  it.each(['transfer.success', 'transfer.failed', 'transfer.reversed'])('routes %s to payouts', async (event) => {
    const data = { reference: 'payout_x', transfer_code: 'TRF_1', reason: 'r' };
    await send(event, data);
    expect(bookings.handleTransferEvent).toHaveBeenCalledWith(event, data);
  });

  it('ignores other events', async () => {
    await expect(send('customeridentification.success', {})).resolves.toEqual({ received: true });
    expect(bookings.handleTransferEvent).not.toHaveBeenCalled();
  });
});

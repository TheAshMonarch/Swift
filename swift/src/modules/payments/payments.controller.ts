import {
  Controller,
  Post,
  Headers,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { BookingsService } from '../bookings/bookings.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private bookingsService: BookingsService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const rawBody = req.rawBody?.toString() || '';

    const isValid = this.paymentsService.verifyWebhookSignature(signature, rawBody);
    if (!isValid) throw new BadRequestException('Invalid webhook signature');

    const event = JSON.parse(rawBody);

    // Only care about successful payments
    if (event.event === 'charge.success') {
      await this.bookingsService.confirmFunding(event.data.reference);
    }

    return { received: true };
  }
}
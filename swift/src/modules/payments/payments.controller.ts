import {
  Controller,
  Post,
  Get,
  UseGuards,
  Headers,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { BookingsService } from '../bookings/bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private bookingsService: BookingsService,
  ) {}

  // Bank list for the payout-details form (bankCode goes into PUT /users/me)
  @Get('banks')
  @UseGuards(JwtAuthGuard)
  getBanks() {
    return this.paymentsService.getBanks();
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle() // Paystack retries must never be rate-limited
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
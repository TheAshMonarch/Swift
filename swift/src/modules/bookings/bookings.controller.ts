import { Controller, Post, Put, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RateBookingDto } from './dto/rate-booking.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Req() req: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(req.user.userId, dto);
  }

  @Put(':id/accept')
  @UseGuards(JwtAuthGuard)
  accept(@Req() req: any, @Param('id', IsObjectIdPipe) id: string) {
    return this.bookingsService.accept(id, req.user.userId);
  }

  @Post(':id/fund')
  @UseGuards(JwtAuthGuard)
  initiateFunding(@Req() req: any, @Param('id', IsObjectIdPipe) id: string) {
    return this.bookingsService.initiateFunding(id, req.user.userId);
  }

  // SECURITY: funding confirmation is handled exclusively by the
  // signature-verified Paystack webhook (POST /payments/webhook).
  // The previously public /bookings/confirm-payment endpoint was removed.

  @Put(':id/complete')
  @UseGuards(JwtAuthGuard)
  markComplete(@Req() req: any, @Param('id', IsObjectIdPipe) id: string) {
    return this.bookingsService.markComplete(id, req.user.userId);
  }

  @Put(':id/release')
  @UseGuards(JwtAuthGuard)
  releaseFunds(@Req() req: any, @Param('id', IsObjectIdPipe) id: string) {
    return this.bookingsService.releaseFunds(id, req.user.userId);
  }

  @Put(':id/start')
  @UseGuards(JwtAuthGuard)
  startJob(@Req() req: any, @Param('id', IsObjectIdPipe) id: string) {
    return this.bookingsService.startJob(id, req.user.userId);
  }

  @Put(':id/dispute')
  @UseGuards(JwtAuthGuard)
  raiseDispute(@Req() req: any, @Param('id', IsObjectIdPipe) id: string, @Body('reason') reason: string) {
    return this.bookingsService.raiseDispute(id, req.user.userId, reason);
  }

  @Post(':id/rating')
  @UseGuards(JwtAuthGuard)
  rate(@Req() req: any, @Param('id', IsObjectIdPipe) id: string, @Body() dto: RateBookingDto) {
    return this.bookingsService.rate(id, req.user.userId, dto.rating);
  }

  @Get('my-bookings')
  @UseGuards(JwtAuthGuard)
  getMyBookings(@Req() req: any) {
    const { userId, role } = req.user;
    return role === 'professional'
      ? this.bookingsService.findByProfessional(userId)
      : this.bookingsService.findBySeeker(userId);
  }
}
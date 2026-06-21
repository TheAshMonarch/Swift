import { Controller, Post, Put, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(req.user.userId, dto);
  }

  @Put(':id/accept')
  accept(@Req() req: any, @Param('id') id: string) {
    return this.bookingsService.accept(id, req.user.userId);
  }

  @Post(':id/fund')
  initiateFunding(@Req() req: any, @Param('id') id: string) {
    return this.bookingsService.initiateFunding(id, req.user.userId);
  }

  @Post('confirm-payment')
  confirmPayment(@Body('reference') reference: string) {
    return this.bookingsService.confirmFunding(reference);
  }

  @Put(':id/complete')
  markComplete(@Req() req: any, @Param('id') id: string) {
    return this.bookingsService.markComplete(id, req.user.userId);
  }

  @Put(':id/release')
  releaseFunds(@Req() req: any, @Param('id') id: string) {
    return this.bookingsService.releaseFunds(id, req.user.userId);
  }

  @Put(':id/dispute')
  raiseDispute(@Req() req: any, @Param('id') id: string, @Body('reason') reason: string) {
    return this.bookingsService.raiseDispute(id, req.user.userId, reason);
  }

  @Get('my-bookings')
  getMyBookings(@Req() req: any) {
    const { userId, role } = req.user;
    return role === 'professional'
      ? this.bookingsService.findByProfessional(userId)
      : this.bookingsService.findBySeeker(userId);
  }
}
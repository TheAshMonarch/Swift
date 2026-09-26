import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchProvidersDto } from './dto/search-providers.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() req: any) {
    return this.usersService.findById(req.user.userId);
  }

  @Put('me')
  updateMe(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.usersService.update(req.user.userId, dto);
  }

  @Post('search/providers')
  searchProviders(@Body() dto: SearchProvidersDto) {
    return this.usersService.searchProviders(dto);
  }

  // Public-safe profile view: no phone, bank details, or password hash.
  @Get(':id')
  findById(@Param('id', IsObjectIdPipe) id: string) {
    return this.usersService.findPublicById(id).then((user) => {
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  // Ratings live on bookings: POST /bookings/:id/rating (one per completed booking).

  @Get(':id/stats')
  getStats(@Param('id', IsObjectIdPipe) id: string) {
    return this.usersService.getProviderStats(id);
  }
}
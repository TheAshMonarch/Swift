import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchProvidersDto } from './dto/search-providers.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IsNumber, Min, Max } from 'class-validator';

export class AddRatingDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  rating!: number;
}

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
  findById(@Param('id') id: string) {
    return this.usersService.findPublicById(id).then((user) => {
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  @Post(':id/rating')
  addRating(@Param('id') id: string, @Body() dto: AddRatingDto) {
    // TODO: restrict to users with a COMPLETED booking for this provider.
    return this.usersService.addRating(id, dto.rating);
  }

  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.usersService.getProviderStats(id);
  }
}
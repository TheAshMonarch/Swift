import { Controller, Get, Post, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchProvidersDto } from './dto/search-providers.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: any) {
    return this.usersService.findById(req.user.userId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.usersService.update(req.user.userId, dto);
  }

  @Post('search/providers')
  searchProviders(@Body() dto: SearchProvidersDto) {
    return this.usersService.searchProviders(dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post(':id/rating')
  @UseGuards(JwtAuthGuard)
  addRating(@Param('id') id: string, @Body('rating') rating: number) {
    return this.usersService.addRating(id, rating);
  }

  @Get(':id/stats')
  @UseGuards(JwtAuthGuard)
  getStats(@Param('id') id: string) {
    return this.usersService.getProviderStats(id);
  }
}
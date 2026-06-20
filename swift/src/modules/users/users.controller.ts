import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '@common/decorators/get-user.decorator';

@Controller('users')
export class UsersController {
  
  @Get('me')
  @UseGuards(JwtAuthGuard) // First, the guard checks the JWT token
  getProfile(@GetUser() user: { userId: string; email: string; role: string }): { userId: string; email: string; role: string } {
    // The decorator automatically plucks the user out here
    return user;
  }

  @Get('my-id')
  @UseGuards(JwtAuthGuard)
  getOnlyId(@GetUser('userId') userId: string): { id: string } {
    // You can also grab a single property directly out of the token payload
    return { id: userId };
  }
}

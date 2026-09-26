import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { User } from '../users/users.schema';
import { GoogleLoginDto } from './google-login.dto';
import { VerifyOtpDto } from './verify-otp.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './reset-password.dto';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';

export class ResendOtpDto {
  @IsEmail()
  email!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async signup(@Body() registerDto: RegisterDto): Promise<Omit<User, 'passwordHash'>> {
    return await this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // brute-force protection
  async login(@Body() loginDto: LoginDto): Promise<{ message: string; accessToken: string; user: Omit<User, 'passwordHash'> }> {
    return this.authService.login(loginDto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() googleLoginDto: GoogleLoginDto): Promise<{ message: string; accessToken: string; user: Omit<User, 'passwordHash'>; }>{
    return this.authService.googleLogin(googleLoginDto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // guess-limiting for the 6-digit code
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto): Promise<{ message: string }> {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // email-sending abuse prevention
  async resendOtp(
    @Body(new ValidationPipe({ whitelist: true })) dto: ResendOtpDto,
  ): Promise<{ message: string }> {
    return this.authService.sendOtp(dto.email);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // email-sending abuse prevention
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // guess-limiting (plus per-code attempt cap)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.authService.resetPassword(dto);
  }
}

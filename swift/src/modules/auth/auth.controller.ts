import { Controller, Post, Get, Body, Res, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { User } from '../users/users.schema';
import { GoogleLoginDto } from './google-login.dto';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { VerifyOtpDto } from './verify-otp.dto';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async signup(@Body() registerDto: RegisterDto): Promise<Omit<User, 'passwordHash'>> {
    return await this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<{ message: string; accessToken: string; role: string }> {
    return this.authService.login(loginDto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() googleLoginDto: GoogleLoginDto): Promise<{ message: string; accessToken: string; role: string }>{
    return this.authService.googleLogin(googleLoginDto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto): Promise<{ message: string }> {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body('phoneOrEmail') phoneOrEmail: string): Promise<{ message: string }> {
    return this.authService.sendOtp(phoneOrEmail);
  }

}

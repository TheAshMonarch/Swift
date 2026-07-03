// auth.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Otp, OtpSchema } from './otp.schema';
import { MailerModule } from '@nestjs-modules/mailer';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    MongooseModule.forFeature([{ name: Otp.name, schema: OtpSchema }]), 
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
    
  // Mailer configuration hooked up to environment variables
  MailerModule.forRoot({
    transport: {
      host: process.env.MAIL_HOST,
      port: 465,
      secure: true, // true for 465
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD,
      },
      connectionTimeout: 15000, // 15 seconds timeout
      greetingTimeout: 10000,
      socketTimeout: 10000,
      dnsLookup: (hostname: string, options: any, callback: any) => {
        // Forcing family: 4 restricts DNS resolution strictly to IPv4 address records
        require('dns').lookup(hostname, { family: 4 }, callback);
      },
    } as any,
  }),
],
  controllers: [AuthController],
  providers: [
    AuthService, 
    JwtStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
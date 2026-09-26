import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module'
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ChatModule } from './modules/chat/chat.module';
import { KycModule } from './modules/kyc/kyc.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Load the .env configuration file globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),

    // Connect to MongoDB asynchronously using your .env URI variable
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),

    // Global rate limiting (per-IP). Endpoint-specific limits via @Throttle().
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minute
        limit: 60, // 60 requests/minute baseline
      },
    ]),

    UsersModule,
    AuthModule,
    BookingsModule,
    PaymentsModule,
    ChatModule,
    KycModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

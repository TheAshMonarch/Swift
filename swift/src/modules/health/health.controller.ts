import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { Connection, ConnectionStates } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  // Liveness + DB readiness probe for load balancers / uptime monitors.
  @Get()
  @SkipThrottle()
  check() {
    if (this.connection.readyState !== ConnectionStates.connected) {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok', db: 'up', uptime: Math.round(process.uptime()) };
  }
}

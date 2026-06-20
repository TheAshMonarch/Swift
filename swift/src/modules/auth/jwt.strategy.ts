import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      // Grab the bearer token out of the HTTP Authorization header
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback_secret',
    });
  }

  // Inside your endpoints, access the verified user payload via req.user
  async validate(payload: { sub: string; email: string; role: string }): Promise<{ userId: string; email: string; role: string }> {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}

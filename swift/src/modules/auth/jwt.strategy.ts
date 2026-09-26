import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      // SECURITY: refuse to start with a guessable/absent secret instead of
      // silently falling back to a hardcoded value.
      throw new Error('JWT_SECRET environment variable is not configured');
    }

    super({
      // Grab the bearer token out of the HTTP Authorization header
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Inside your endpoints, access the verified user payload via req.user
  async validate(payload: { sub: string; email: string; role: string }): Promise<{ userId: string; email: string; role: string }> {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}

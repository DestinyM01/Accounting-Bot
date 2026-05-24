import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri:
          process.env.AUTHENTIK_JWKS_URI ||
          'http://10.0.0.98:9000/application/o/bot-angular-auth/jwks/',
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer:
        process.env.AUTHENTIK_ISSUER ||
        'http://10.0.0.98:9000/application/o/bot-angular-auth/',
      algorithms: ['RS256'],
    });
  }

  validate(payload: any) {
    return payload; // attaches to req.user
  }
}

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

/** The passport-jwt options, from the environment. A function so the audience rule can be tested. */
export function jwtOptions(env: NodeJS.ProcessEnv = process.env) {
  const audience = env.AUTHENTIK_CLIENT_ID?.trim();
  return {
    secretOrKeyProvider: passportJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri:
        env.AUTHENTIK_JWKS_URI ||
        'http://10.0.0.98:9000/application/o/bot-angular-auth/jwks/',
    }),
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    issuer:
      env.AUTHENTIK_ISSUER ||
      'http://10.0.0.98:9000/application/o/bot-angular-auth/',
    algorithms: ['RS256'] as const,
    // Authentik puts the application's client id in `aud`: a token issued to
    // another application on the same Authentik is refused.
    ...(audience ? { audience } : {}),
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor() {
    super(jwtOptions());
  }

  /**
   * Every account on the Authentik instance gets a valid token; only the owner
   * may use AccBot. Until OWNER_SUB is set nobody can, and the log names the id
   * of whoever tried, so the owner can copy theirs into the Secret.
   */
  validate(payload: { sub?: string } & Record<string, unknown>) {
    const owner = process.env.OWNER_SUB?.trim();
    if (!owner) {
      this.logger.warn(
        `No OWNER_SUB configured: refusing everyone. If this login was yours, set OWNER_SUB to "${payload.sub}" in the api's Secret and restart.`,
      );
      throw new ForbiddenException("AccBot isn't set up for an owner yet — see the api log.");
    }
    if (payload.sub !== owner) {
      this.logger.warn(`Refused a login from another account (sub "${payload.sub}")`);
      throw new ForbiddenException("This account can't use AccBot.");
    }
    return payload; // attaches to req.user
  }
}

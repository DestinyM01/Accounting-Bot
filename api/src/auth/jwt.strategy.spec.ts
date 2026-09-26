import { ForbiddenException, Logger } from '@nestjs/common';
import { JwtStrategy, jwtOptions } from './jwt.strategy';

describe('JwtStrategy', () => {
  const env = { ...process.env };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('lets the owner in', () => {
    process.env.OWNER_SUB = 'owner-sub';
    const payload = { sub: 'owner-sub', email: 'owner@example.com' };
    expect(new JwtStrategy().validate(payload)).toBe(payload);
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses any other account with a 403 and logs its id', () => {
    process.env.OWNER_SUB = 'owner-sub';
    expect(() => new JwtStrategy().validate({ sub: 'someone-else' })).toThrow(ForbiddenException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('someone-else'));
  });

  it('refuses everyone while OWNER_SUB is unset, and logs the id to set', () => {
    delete process.env.OWNER_SUB;
    expect(() => new JwtStrategy().validate({ sub: 'first-login' })).toThrow(ForbiddenException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('set OWNER_SUB to "first-login"'));
  });

  it('treats a blank OWNER_SUB as unset', () => {
    process.env.OWNER_SUB = '   ';
    expect(() => new JwtStrategy().validate({ sub: '   ' })).toThrow(ForbiddenException);
  });

  it('checks the audience only when AUTHENTIK_CLIENT_ID is set', () => {
    expect(jwtOptions({})).not.toHaveProperty('audience');
    expect(jwtOptions({ AUTHENTIK_CLIENT_ID: ' client-1 ' })).toMatchObject({ audience: 'client-1' });
  });

  it('keeps the issuer and RS256', () => {
    expect(jwtOptions({ AUTHENTIK_ISSUER: 'https://auth.example/app/' })).toMatchObject({
      issuer: 'https://auth.example/app/',
      algorithms: ['RS256'],
    });
  });
});

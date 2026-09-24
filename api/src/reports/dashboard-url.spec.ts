import { dashboardUrl } from './dashboard-url';

describe('dashboardUrl', () => {
  const saved = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (saved === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = saved;
  });

  it('uses CORS_ORIGIN without trailing slashes, and the production host by default', () => {
    process.env.CORS_ORIGIN = 'https://dashboard.example.com/';
    expect(dashboardUrl()).toBe('https://dashboard.example.com');
    delete process.env.CORS_ORIGIN;
    expect(dashboardUrl()).toBe('https://bot.andujaronline.uk');
  });
});

import { MailClient } from './mail.client';

describe('MailClient', () => {
  it('returns an empty list and does not throw when credentials are missing', async () => {
    const prevUser = process.env.GMAIL_USER;
    const prevPass = process.env.GMAIL_APP_PASSWORD;
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;

    const client = new MailClient();
    await expect(client.fetchSince(new Date(), ['a@b.com'])).resolves.toEqual([]);

    if (prevUser !== undefined) process.env.GMAIL_USER = prevUser;
    if (prevPass !== undefined) process.env.GMAIL_APP_PASSWORD = prevPass;
  });
});

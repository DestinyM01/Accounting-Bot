jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

import * as nodemailer from 'nodemailer';
import { MailerService } from './mailer.service';

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

describe('MailerService', () => {
  const savedEnv = { ...process.env };
  let sendMail: jest.Mock;
  const email = { subject: 'Weekly digest', html: '<p>hi</p>', text: 'hi' };

  beforeEach(() => {
    process.env.GMAIL_USER = 'me@example.com';
    process.env.GMAIL_APP_PASSWORD = 'app-password';
    delete process.env.REPORT_TO;
    sendMail = jest.fn().mockResolvedValue({});
    createTransport.mockReset().mockReturnValue({ sendMail });
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it('is configured only when both Gmail credentials are set', () => {
    const mailer = new MailerService();
    expect(mailer.isConfigured()).toBe(true);
    delete process.env.GMAIL_APP_PASSWORD;
    expect(mailer.isConfigured()).toBe(false);
    process.env.GMAIL_APP_PASSWORD = 'app-password';
    delete process.env.GMAIL_USER;
    expect(mailer.isConfigured()).toBe(false);
  });

  it('sends through Gmail SMTP to GMAIL_USER by default', async () => {
    await new MailerService().send(email);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'me@example.com', pass: 'app-password' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: '"AccBot" <me@example.com>',
      to: 'me@example.com',
      subject: 'Weekly digest',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('sends to REPORT_TO when it is set', async () => {
    process.env.REPORT_TO = 'other@example.com';
    await new MailerService().send(email);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'other@example.com' }));
  });

  it('refuses to send when not configured', async () => {
    delete process.env.GMAIL_APP_PASSWORD;
    await expect(new MailerService().send(email)).rejects.toThrow(/not configured/);
    expect(createTransport).not.toHaveBeenCalled();
  });
});

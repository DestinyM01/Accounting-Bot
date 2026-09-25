import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface OutgoingEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends the user's reports through Gmail SMTP with the same app password the
 * ingester uses for IMAP. The recipient is resolved by the caller from
 * Settings (saved on the web, else `REPORT_TO`, else `GMAIL_USER`).
 */
@Injectable()
export class MailerService {
  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    return !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;
  }

  async send(email: OutgoingEmail, to: string): Promise<void> {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) throw new Error('Email is not configured: GMAIL_USER / GMAIL_APP_PASSWORD missing');

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass },
        // A stalled send must not hold the Dashboard's test button for
        // nodemailer's default of up to ten minutes.
        connectionTimeout: 30_000,
        socketTimeout: 60_000,
      });
    }
    await this.transporter.sendMail({
      from: `"AccBot" <${user}>`,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }
}

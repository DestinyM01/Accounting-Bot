import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface FetchedMail {
  messageId: string; // RFC message id — the dedupe key
  sender: string; // lowercased
  subject: string;
  body: string; // plain text
  receivedAt: Date;
}

@Injectable()
export class MailClient {
  private readonly logger = new Logger(MailClient.name);

  /**
   * Fetches mail received since `since` from the configured mailbox,
   * keeping only messages from the given sender allow-list.
   * Opens the mailbox READ-ONLY — never mutates the user's mail.
   */
  async fetchSince(since: Date, senders: string[]): Promise<FetchedMail[]> {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      this.logger.warn('GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping fetch');
      return [];
    }

    const mailbox = process.env.INGEST_MAILBOX || 'INBOX';
    const allow = senders.map((s) => s.toLowerCase());

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user, pass },
      logger: false,
    });

    const out: FetchedMail[] = [];
    await client.connect();
    try {
      // readOnly so we never flag messages as seen
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
          if (!msg.source) continue;

          const parsed = await simpleParser(msg.source);
          const sender = (parsed.from?.value?.[0]?.address ?? '').toLowerCase();
          if (!allow.includes(sender)) continue;

          const envelopeDate = msg.envelope?.date ? new Date(msg.envelope.date) : undefined;
          const receivedAt = parsed.date ?? envelopeDate ?? new Date();

          // IMAP SEARCH SINCE is date-granular: it returns everything from
          // 00:00 of the watermark's day. The watermark carries a time of
          // day, so anything from earlier that day must be dropped here.
          if (receivedAt < since) continue;

          out.push({
            messageId: parsed.messageId ?? `uid-${msg.uid}`,
            sender,
            subject: parsed.subject ?? '',
            body: parsed.text ?? '',
            receivedAt,
          });
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      this.logger.error('IMAP fetch failed', err instanceof Error ? err.stack : String(err));
    } finally {
      await client.logout().catch(() => undefined);
    }

    this.logger.log(`Fetched ${out.length} matching mail(s) since ${since.toISOString()}`);
    return out;
  }
}

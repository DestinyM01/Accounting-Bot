import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { htmlToText } from './html-to-text';

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
      let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>>;
      try {
        lock = await client.getMailboxLock(mailbox, { readOnly: true });
      } catch (err) {
        // A missing or misnamed label must not degrade into an empty,
        // healthy-looking run. Name the mailbox so the fix is obvious, and
        // let poll() log it at error level on every attempt until it is.
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot open mailbox "${mailbox}": ${reason}`);
      }
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
            // Some banks (BHD) send HTML only: fall back to its tables as pipe rows.
            body: parsed.text?.trim() ? parsed.text : typeof parsed.html === 'string' ? htmlToText(parsed.html) : '',
            receivedAt,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      // Failures propagate to the caller, which logs them at error level.
      // Swallowing them here returned [] and let the run report itself healthy.
      await client.logout().catch(() => undefined);
    }

    this.logger.log(`Fetched ${out.length} matching mail(s) since ${since.toISOString()}`);
    return out;
  }
}

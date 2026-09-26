import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { htmlToText } from './html-to-text';
import { verifySender } from './mail-auth';

export interface FetchedMail {
  messageId: string; // RFC message id — the dedupe key
  sender: string; // lowercased
  subject: string;
  body: string; // plain text
  /** The sender's own claimed Date header (or the envelope date, or now); forgeable, sometimes days late. Judged against notBefore. */
  receivedAt: Date;
  /** Gmail's own arrival time (IMAP internalDate); the sender can't set this. The moving window is judged against it. */
  arrivedAt: Date;
  /** Gmail's own checks (DMARC or DKIM) passed for the sender's domain; see mail-auth.ts. */
  verified: boolean;
  /** A bug of ours (not the sender's) kept the body from being read at all; only the envelope could be. Always unverified, with an empty body. */
  unopened?: boolean;
}

@Injectable()
export class MailClient {
  private readonly logger = new Logger(MailClient.name);

  /**
   * Fetches mail that ARRIVED (Gmail's own internalDate) since `since` from
   * the configured mailbox, keeping only messages from the given sender
   * allow-list, and — when `notBefore` is given — only those whose own
   * claimed date is not earlier than it (the configured-start business rule:
   * historical mail is never booked, regardless of when it happens to arrive).
   * Opens the mailbox READ-ONLY — never mutates the user's mail.
   *
   * Returns null — never [] — when GMAIL_USER/GMAIL_APP_PASSWORD are unset,
   * the documented way to pause ingestion: the caller must tell "paused,
   * mailbox never opened" apart from "opened it, found nothing", since only
   * the latter may advance the reading window.
   */
  async fetchSince(since: Date, senders: string[], notBefore?: Date | null): Promise<FetchedMail[] | null> {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      this.logger.warn('GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping fetch');
      return null;
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
        for await (const msg of client.fetch({ since }, { source: true, envelope: true, internalDate: true })) {
          if (!msg.source) continue;

          // Computed from the envelope alone, before parsing the body: Gmail's
          // own arrival time, needed even when parsing the body fails below.
          const envelopeDate = msg.envelope?.date ? new Date(msg.envelope.date) : undefined;
          const arrivedAt = msg.internalDate ? new Date(msg.internalDate) : (envelopeDate ?? new Date());

          // One malformed message must not end the run for every other mail.
          try {
            const parsed = await simpleParser(msg.source);
            const sender = (parsed.from?.value?.[0]?.address ?? '').toLowerCase();
            if (!allow.includes(sender)) continue;

            const receivedAt = parsed.date ?? envelopeDate ?? new Date();

            // The moving window is measured on Gmail's own arrival time, not
            // the sender's Date header: a bank outage or an SMTP retry (these
            // can run 4-5 days) can push the Date header far into the past,
            // and a forged one could otherwise drag the window itself back.
            // IMAP SEARCH SINCE is date-granular — it returns everything from
            // 00:00 of the watermark's day — so anything that arrived earlier
            // that same day must still be dropped here.
            if (arrivedAt < since) continue;
            // The configured start is a business rule (historical mail is
            // never booked), judged on the mail's own claimed date.
            if (notBefore && receivedAt < notBefore) continue;

            // headerLines keeps the headers in order: the first is the topmost, the one Gmail added.
            const authResults = parsed.headerLines?.find((h) => h.key === 'authentication-results')?.line;
            let verified = false;
            try {
              verified = verifySender(authResults, sender);
            } catch (err) {
              // A bug of ours in mail-auth.ts must not drop the mail outright:
              // worse than booking one Gmail didn't actually vouch for is
              // losing it for good. Left unverified — MAIL_VERIFY=enforce
              // still catches it below.
              this.logger.warn(`Could not verify ${sender} (uid ${msg.uid}): ${err instanceof Error ? err.message : String(err)}`);
            }

            out.push({
              messageId: parsed.messageId ?? `uid-${msg.uid}`,
              sender,
              subject: parsed.subject ?? '',
              // Some banks (BHD) send HTML only: fall back to its tables as pipe rows.
              body: parsed.text?.trim() ? parsed.text : typeof parsed.html === 'string' ? htmlToText(parsed.html) : '',
              receivedAt,
              arrivedAt,
              verified,
            });
          } catch (err) {
            // A bug of OURS (the parser, htmlToText, ...) must not silently
            // drop a whole bank's mail once it ages out of the window a
            // couple of days later. The envelope is fetched (and so is
            // usable) independently of the body: when it still names an
            // allow-listed sender, list the mail as unopened instead of
            // skipping it outright — Settings can then show it, and it
            // holds the window open until it's fixed or dismissed.
            const envelopeSender = (msg.envelope?.from?.[0]?.address ?? '').toLowerCase();
            if (msg.envelope && allow.includes(envelopeSender)) {
              const receivedAt = envelopeDate ?? arrivedAt;
              if (arrivedAt < since) continue;
              if (notBefore && receivedAt < notBefore) continue;

              this.logger.error(`Couldn't open a mail from ${envelopeSender} (uid ${msg.uid}): ${err instanceof Error ? err.message : String(err)}`);
              out.push({
                messageId: msg.envelope.messageId ?? `uid-${msg.uid}`,
                sender: envelopeSender,
                subject: msg.envelope.subject ?? '',
                body: '',
                receivedAt,
                arrivedAt,
                verified: false,
                unopened: true,
              });
            } else {
              this.logger.warn(`Skipped an unparseable mail (uid ${msg.uid}): ${err instanceof Error ? err.message : String(err)}`);
            }
          }
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

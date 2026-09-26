// imapflow and mailparser are the network edge. Both are mocked so the
// filtering and failure behaviour can be exercised without a mailbox. The
// `mock` prefix is required for jest.mock factories to reference them.
const mockConnect = jest.fn();
const mockGetMailboxLock = jest.fn();
const mockFetch = jest.fn();
const mockLogout = jest.fn();
const mockImapFlow = jest.fn();
jest.mock('imapflow', () => ({
  ImapFlow: function (this: any, opts: unknown) {
    mockImapFlow(opts);
    return { connect: mockConnect, getMailboxLock: mockGetMailboxLock, fetch: mockFetch, logout: mockLogout };
  },
}));

const mockSimpleParser = jest.fn();
jest.mock('mailparser', () => ({
  simpleParser: (...args: unknown[]) => mockSimpleParser(...args),
}));

import { Logger } from '@nestjs/common';
import { MailClient } from './mail.client';
import * as mailAuth from './mail-auth';

const SENDER = 'a@b.com';

/** A parsed message as mailparser would hand it back, keyed by the raw source text. */
function parsedMail(id: string, date: Date) {
  return {
    from: { value: [{ address: SENDER }] },
    subject: id,
    text: `body of ${id}`,
    messageId: `<${id}>`,
    date,
  };
}

describe('MailClient', () => {
  const env = { ...process.env };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    process.env.GMAIL_USER = 'mailbox-user';
    process.env.GMAIL_APP_PASSWORD = 'app-password';
    process.env.INGEST_MAILBOX = 'Banks';

    mockConnect.mockResolvedValue(undefined);
    mockLogout.mockResolvedValue(undefined);
    mockGetMailboxLock.mockResolvedValue({ release: jest.fn() });
    mockFetch.mockImplementation(async function* () {
      /* no messages by default */
    });
  });

  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  // null (not []) tells the caller "the mailbox was never opened" — the
  // documented way to pause ingestion. Returning [] here would look
  // indistinguishable from "opened it, found nothing", and the caller
  // (IngestionService.run) would move its resume point regardless, silently
  // losing everything older than the overlap once credentials come back.
  it('returns null and does not throw when credentials are missing', async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;

    const client = new MailClient();
    await expect(client.fetchSince(new Date(), [SENDER])).resolves.toBeNull();
    expect(mockImapFlow).not.toHaveBeenCalled();
  });

  // IMAP SEARCH SINCE is date-granular: it returns everything from 00:00 of
  // the watermark's calendar day. The watermark carries a time of day, and a
  // message that ARRIVED earlier that same day must not be ingested. The
  // moving window is judged on Gmail's own arrival time (internalDate), not
  // the sender's Date header — both messages here claim the same Date header,
  // so only their internalDate tells them apart.
  it('drops a message that arrived earlier on the watermark day and keeps one that arrived after', async () => {
    const since = new Date('2026-01-01T18:00:00Z');
    mockFetch.mockImplementation(async function* () {
      yield { uid: 1, source: Buffer.from('early'), internalDate: new Date('2026-01-01T10:00:00Z') };
      yield { uid: 2, source: Buffer.from('late'), internalDate: new Date('2026-01-01T20:00:00Z') };
    });
    mockSimpleParser.mockImplementation(async (src: Buffer) => parsedMail(src.toString(), new Date('2026-01-01T20:00:00Z')));

    const out = await new MailClient().fetchSince(since, [SENDER]);

    expect(out.map((m) => m.messageId)).toEqual(['<late>']);
  });

  describe('arrival-time window (I2)', () => {
    // SMTP retries can run 4-5 days; a bank alert delayed that long must
    // still be read once it finally arrives, even though its own Date header
    // is now well outside the window.
    it('keeps a mail whose Date header is old but that arrived after `since`', async () => {
      mockFetch.mockImplementation(async function* () {
        yield { uid: 1, source: Buffer.from('m'), internalDate: new Date('2026-01-05T00:00:00Z') };
      });
      mockSimpleParser.mockResolvedValue(parsedMail('m', new Date('2026-01-01T00:00:00Z')));

      const out = await new MailClient().fetchSince(new Date('2026-01-04T00:00:00Z'), [SENDER]);

      expect(out.map((m) => m.messageId)).toEqual(['<m>']);
    });

    // A forged Date header must not drag the moving window back: the window
    // is judged on Gmail's own arrival time, which the sender cannot set.
    it('drops a mail that arrived before `since`, even when its Date header is newer', async () => {
      mockFetch.mockImplementation(async function* () {
        yield { uid: 1, source: Buffer.from('m'), internalDate: new Date('2026-01-01T00:00:00Z') };
      });
      mockSimpleParser.mockResolvedValue(parsedMail('m', new Date('2026-01-05T00:00:00Z')));

      const out = await new MailClient().fetchSince(new Date('2026-01-04T00:00:00Z'), [SENDER]);

      expect(out).toEqual([]);
    });

    // notBefore is the configured-start business rule (historical mail is
    // never booked), judged on the mail's own claimed date — separate from
    // the moving window, which is judged on arrival.
    it('drops a mail whose Date header is before `notBefore`, even though it arrived inside the window', async () => {
      mockFetch.mockImplementation(async function* () {
        yield { uid: 1, source: Buffer.from('m'), internalDate: new Date('2026-01-05T00:00:00Z') };
      });
      mockSimpleParser.mockResolvedValue(parsedMail('m', new Date('2026-01-01T00:00:00Z')));

      const out = await new MailClient().fetchSince(new Date('2026-01-04T00:00:00Z'), [SENDER], new Date('2026-01-03T00:00:00Z'));

      expect(out).toEqual([]);
    });

    it("keeps arrivedAt as Gmail's own internal date on each returned mail", async () => {
      const arrived = new Date('2026-01-05T00:00:00Z');
      mockFetch.mockImplementation(async function* () {
        yield { uid: 1, source: Buffer.from('m'), internalDate: arrived };
      });
      mockSimpleParser.mockResolvedValue(parsedMail('m', new Date('2026-01-05T00:00:00Z')));

      const [mail] = await new MailClient().fetchSince(new Date('2026-01-04T00:00:00Z'), [SENDER]);

      expect(mail.arrivedAt).toEqual(arrived);
    });
  });

  // A missing or misnamed label (or one with IMAP disabled) must not degrade
  // into an empty, healthy-looking run every ten minutes. The failure has to
  // reach poll(), which logs it at error level, and it has to name the
  // mailbox so the fix is obvious. The underlying IMAP error deliberately
  // does NOT mention the mailbox here, so the name must come from us.
  it('rejects with the mailbox name when the mailbox cannot be opened', async () => {
    mockGetMailboxLock.mockRejectedValue(new Error('Command failed'));

    await expect(new MailClient().fetchSince(new Date(), [SENDER])).rejects.toThrow(/Banks/);
    expect(mockLogout).toHaveBeenCalled();
  });

  it('opens the mailbox read-only', async () => {
    await new MailClient().fetchSince(new Date(), [SENDER]);

    expect(mockGetMailboxLock).toHaveBeenCalledWith('Banks', { readOnly: true });
  });

  // BHD's alerts have no text/plain part — mailparser hands back `text:
  // undefined` — so the body must fall back to reading the HTML's tables.
  it('falls back to the HTML tables as pipe rows when a mail has no text', async () => {
    mockFetch.mockImplementation(async function* () {
      yield { uid: 1, source: Buffer.from('html-only') };
    });
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: SENDER }] },
      subject: 'html-only',
      text: undefined,
      html: '<table><tr><td>a</td><td>b</td></tr></table>',
      messageId: '<html-only>',
      date: new Date('2026-01-01T20:00:00Z'),
    });

    const out = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);

    expect(out[0].body).toBe('| a | b |');
  });

  it('keeps the plain text verbatim when a mail has one', async () => {
    mockFetch.mockImplementation(async function* () {
      yield { uid: 1, source: Buffer.from('has-text') };
    });
    mockSimpleParser.mockResolvedValue(parsedMail('has-text', new Date('2026-01-01T20:00:00Z')));

    const out = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);

    expect(out[0].body).toBe('body of has-text');
  });

  const GMAIL_PASS = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@b.com header.s=s1;\r\n       dmarc=pass (p=REJECT) header.from=b.com';

  it('marks a mail verified when the topmost Authentication-Results is a Gmail pass for its domain', async () => {
    mockFetch.mockImplementation(async function* () { yield { uid: 1, source: Buffer.from('m') }; });
    mockSimpleParser.mockResolvedValue({
      ...parsedMail('m', new Date('2026-01-02T00:00:00Z')),
      headerLines: [{ key: 'authentication-results', line: GMAIL_PASS }],
    });
    const [mail] = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);
    expect(mail.verified).toBe(true);
  });

  it('ignores a forged pass below a failing topmost header', async () => {
    mockFetch.mockImplementation(async function* () { yield { uid: 1, source: Buffer.from('m') }; });
    mockSimpleParser.mockResolvedValue({
      ...parsedMail('m', new Date('2026-01-02T00:00:00Z')),
      headerLines: [
        { key: 'authentication-results', line: 'Authentication-Results: mx.google.com; dkim=fail header.i=@b.com; dmarc=fail header.from=b.com' },
        { key: 'authentication-results', line: GMAIL_PASS },
      ],
    });
    const [mail] = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);
    expect(mail.verified).toBe(false);
  });

  it('marks a mail without the header unverified', async () => {
    mockFetch.mockImplementation(async function* () { yield { uid: 1, source: Buffer.from('m') }; });
    mockSimpleParser.mockResolvedValue(parsedMail('m', new Date('2026-01-02T00:00:00Z')));
    const [mail] = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);
    expect(mail.verified).toBe(false);
  });

  it('skips a message that cannot be parsed and still returns the others', async () => {
    mockFetch.mockImplementation(async function* () {
      yield { uid: 1, source: Buffer.from('one') };
      yield { uid: 2, source: Buffer.from('bad') };
      yield { uid: 3, source: Buffer.from('three') };
    });
    mockSimpleParser.mockImplementation(async (source: Buffer) => {
      const id = source.toString();
      if (id === 'bad') throw new Error('malformed MIME');
      return parsedMail(id, new Date('2026-01-02T00:00:00Z'));
    });
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const mails = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);
    expect(mails.map((m) => m.subject)).toEqual(['one', 'three']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped an unparseable mail (uid 2)'));
  });

  describe('a mail our own code cannot open (I4)', () => {
    // A bug in OUR OWN code (the parser, htmlToText, ...) must not silently
    // drop a whole bank's mail once it ages out of the window a couple of
    // days later. The envelope alone (fetched separately from the body) still
    // names the sender, so it can still be listed instead of lost.
    it('lists a mail as unopened, with an error log, when parsing throws but its envelope names an allow-listed sender', async () => {
      const arrived = new Date('2026-01-05T00:00:00Z');
      mockFetch.mockImplementation(async function* () {
        yield {
          uid: 7,
          source: Buffer.from('bad'),
          internalDate: arrived,
          envelope: {
            from: [{ address: 'A@B.COM' }], // mixed case: sender must still come out lowercased
            subject: 'Alert',
            messageId: '<env-7>',
            date: new Date('2026-01-05T00:00:00Z'),
          },
        };
      });
      mockSimpleParser.mockRejectedValue(new Error('malformed MIME'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      const [mail] = await new MailClient().fetchSince(new Date('2026-01-04T00:00:00Z'), [SENDER]);

      expect(mail).toMatchObject({
        messageId: '<env-7>',
        sender: SENDER,
        subject: 'Alert',
        body: '',
        arrivedAt: arrived,
        verified: false,
        unopened: true,
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`Couldn't open a mail from ${SENDER} (uid 7)`));
    });

    it('does not list (just warns) a mail whose envelope sender is not allow-listed when parsing throws', async () => {
      mockFetch.mockImplementation(async function* () {
        yield { uid: 8, source: Buffer.from('bad'), envelope: { from: [{ address: 'stranger@evil.example' }] } };
      });
      mockSimpleParser.mockRejectedValue(new Error('malformed MIME'));
      const warn = jest.spyOn(Logger.prototype, 'warn');

      const mails = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);

      expect(mails).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped an unparseable mail (uid 8)'));
    });

    it('drops an unopened mail that arrived before `since`, same as any other mail', async () => {
      mockFetch.mockImplementation(async function* () {
        yield {
          uid: 9,
          source: Buffer.from('bad'),
          internalDate: new Date('2026-01-01T00:00:00Z'),
          envelope: { from: [{ address: SENDER }] },
        };
      });
      mockSimpleParser.mockRejectedValue(new Error('malformed MIME'));

      const mails = await new MailClient().fetchSince(new Date('2026-01-04T00:00:00Z'), [SENDER]);

      expect(mails).toEqual([]);
    });
  });

  describe('a throwing verifySender (I4)', () => {
    // A bug of ours in mail-auth.ts must not drop the mail outright — worse
    // than booking one Gmail didn't actually vouch for is losing it for good.
    it('keeps the mail, unverified, when verifySender itself throws', async () => {
      jest.spyOn(mailAuth, 'verifySender').mockImplementation(() => {
        throw new Error('mail-auth exploded');
      });
      mockFetch.mockImplementation(async function* () { yield { uid: 1, source: Buffer.from('m') }; });
      mockSimpleParser.mockResolvedValue(parsedMail('m', new Date('2026-01-02T00:00:00Z')));

      const [mail] = await new MailClient().fetchSince(new Date('2026-01-01T00:00:00Z'), [SENDER]);

      expect(mail.subject).toBe('m');
      expect(mail.verified).toBe(false);
    });
  });
});

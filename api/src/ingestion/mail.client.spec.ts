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

  it('returns an empty list and does not throw when credentials are missing', async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;

    const client = new MailClient();
    await expect(client.fetchSince(new Date(), [SENDER])).resolves.toEqual([]);
    expect(mockImapFlow).not.toHaveBeenCalled();
  });

  // IMAP SEARCH SINCE is date-granular: it returns everything from 00:00 of
  // the watermark's calendar day. The watermark carries a time of day, and a
  // message from earlier that same day must not be ingested.
  it('drops a message received earlier on the watermark day and keeps one received after', async () => {
    const since = new Date('2026-01-01T18:00:00Z');
    mockFetch.mockImplementation(async function* () {
      yield { uid: 1, source: Buffer.from('early') };
      yield { uid: 2, source: Buffer.from('late') };
    });
    mockSimpleParser.mockImplementation(async (src: Buffer) =>
      src.toString() === 'late'
        ? parsedMail('late', new Date('2026-01-01T20:00:00Z'))
        : parsedMail('early', new Date('2026-01-01T10:00:00Z')),
    );

    const out = await new MailClient().fetchSince(since, [SENDER]);

    expect(out.map((m) => m.messageId)).toEqual(['<late>']);
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
});

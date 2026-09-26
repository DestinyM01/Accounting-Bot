import { verifySender } from './mail-auth';

/** A topmost Authentication-Results header as Gmail writes it, folded over lines. */
const header = (...results: string[]) =>
  ['Authentication-Results: mx.google.com;', ...results.map((r, i) => `       ${r}${i < results.length - 1 ? ';' : ''}`)].join('\r\n');

const FROM = 'alerts@bank.example';

describe('verifySender', () => {
  it('passes when DMARC passed for the From domain', () => {
    expect(verifySender(header('dkim=pass header.i=@bank.example header.s=s1 header.b=abc', 'spf=pass (google.com: domain of alerts@bank.example designates 192.0.2.1 as permitted sender) smtp.mailfrom=alerts@bank.example', 'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=bank.example'), FROM)).toBe(true);
  });

  it('passes on DKIM alone, through header.i', () => {
    expect(verifySender(header('dkim=pass header.i=@bank.example header.s=s1', 'dmarc=none'), FROM)).toBe(true);
  });

  it('passes on DKIM alone, through header.d', () => {
    expect(verifySender(header('dkim=pass header.d=bank.example header.s=s1'), FROM)).toBe(true);
  });

  it('passes when the signing domain is the parent of the From domain, or a subdomain of it', () => {
    expect(verifySender(header('dkim=pass header.d=bank.example'), 'alerts@mail.bank.example')).toBe(true);
    expect(verifySender(header('dkim=pass header.d=mail.bank.example'), FROM)).toBe(true);
  });

  it('ignores case', () => {
    expect(verifySender(header('DKIM=Pass header.d=Bank.Example'), 'Alerts@BANK.example')).toBe(true);
  });

  it('fails without a header', () => {
    expect(verifySender(undefined, FROM)).toBe(false);
    expect(verifySender('', FROM)).toBe(false);
  });

  it('fails when the topmost header is not from Gmail', () => {
    expect(verifySender('Authentication-Results: relay.example; dmarc=pass header.from=bank.example', FROM)).toBe(false);
  });

  it('fails when the checks failed', () => {
    expect(verifySender(header('dkim=fail header.i=@bank.example', 'spf=pass smtp.mailfrom=bank.example', 'dmarc=fail header.from=bank.example'), FROM)).toBe(false);
  });

  it('fails when the passing signature belongs to another domain', () => {
    expect(verifySender(header('dkim=pass header.d=mailer.example', 'dmarc=fail header.from=bank.example'), FROM)).toBe(false);
  });

  it('fails for a look-alike domain that merely ends with the same letters', () => {
    expect(verifySender(header('dkim=pass header.d=evilbank.example'), FROM)).toBe(false);
  });

  it('does not let a comment smuggle a pass in', () => {
    expect(verifySender(header('dkim=fail (dkim=pass header.d=bank.example) header.d=bank.example'), FROM)).toBe(false);
  });
});

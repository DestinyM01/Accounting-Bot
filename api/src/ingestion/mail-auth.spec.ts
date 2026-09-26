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

  it('unfolds LF and tab folding', () => {
    expect(
      verifySender(
        ['Authentication-Results: mx.google.com;', '\tdkim=pass header.i=@bank.example header.s=s1'].join('\n'),
        FROM,
      ),
    ).toBe(true);
  });

  it('accepts an authserv-id with a version', () => {
    expect(verifySender('Authentication-Results: mx.google.com 1; dkim=pass header.i=@bank.example', FROM)).toBe(true);
  });

  it('fails for a look-alike authserv-id', () => {
    expect(
      verifySender('Authentication-Results: mx.google.com.evil.example; dkim=pass header.i=@bank.example', FROM),
    ).toBe(false);
  });

  it('fails when the From address itself is not a valid multi-label domain', () => {
    expect(verifySender(header('dkim=pass header.d=bank.example'), 'alerts@example')).toBe(false);
  });

  it('passes for a realistic multi-result Gmail header with DKIM, SPF and DMARC all passing', () => {
    expect(
      verifySender(
        header(
          'dkim=pass header.i=@bank.example header.s=s1 header.b=AbC+/=12',
          'spf=pass (google.com: domain of alerts@bank.example designates 192.0.2.1 as permitted sender) smtp.mailfrom=alerts@bank.example',
          'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=bank.example',
        ),
        FROM,
      ),
    ).toBe(true);
  });

  it('passes when Gmail also reports an ARC result ahead of DKIM, SPF and DMARC', () => {
    expect(
      verifySender(
        header(
          'arc=pass (i=1 spf=pass spfdomain=bank.example dkim=pass dkdomain=bank.example dmarc=pass fromdomain=bank.example)',
          'dkim=pass header.i=@bank.example header.s=s1 header.b=AbC+/=12',
          'spf=pass (google.com: domain of alerts@bank.example designates 192.0.2.1 as permitted sender) smtp.mailfrom=alerts@bank.example',
          'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=bank.example',
        ),
        FROM,
      ),
    ).toBe(true);
  });

  describe("text the sender controls inside Gmail's header", () => {
    it.each([
      ['a quoted envelope sender carrying ; and a fake dkim=pass', header('dkim=none', 'spf=softfail (google.com: domain of transitioning "x;dkim=pass header.i=@bank.example"@evil.example does not designate 192.0.2.9 as permitted sender) smtp.mailfrom="x;dkim=pass header.i=@bank.example"@evil.example', 'dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=bank.example')],
      ['the same without spaces', header('dkim=none', 'spf=neutral smtp.mailfrom="x;dkim=pass.header.i=@bank.example"@evil.example', 'dmarc=fail header.from=bank.example')],
      ['a quoted local part in the attacker\'s own header.i', header('dkim=pass header.i="@bank.example"@evil.example header.s=s1 header.b=AbCd1234', 'dmarc=fail header.from=bank.example')],
      ['a second header.i hidden in the selector', header('dkim=pass header.i=@evil.example header.s=x.header.i=@bank.example header.b=AbCd1234', 'dmarc=fail header.from=bank.example')],
      ['an empty comment splitting the signing domain', header('dkim=pass header.i=@bank.example().evil.example header.s=s1', 'dmarc=fail header.from=bank.example')],
      ['a quote cutting the signing domain short', header('dkim=pass header.i=@bank.example".evil.example header.s=s1', 'dmarc=fail header.from=bank.example')],
      ['a nested comment holding ; and a fake pass', header('spf=pass (a (b) ; dkim=pass header.i=@bank.example ; c) smtp.mailfrom=x@evil.example', 'dmarc=fail header.from=bank.example')],
      ['a comment with ; and a fake pass', header('spf=pass (x; dkim=pass header.i=@bank.example) smtp.mailfrom=x@evil.example', 'dmarc=fail header.from=bank.example')],
      ['an unclosed comment', header('dkim=pass header.i=@bank.example(.evil.example header.s=s1')],
      ['header.d for another domain wins over an aligned header.i', header('dkim=pass header.d=evil.example header.i=@bank.example')],
      ['a single-label parent (a top-level domain) as the signer', header('dkim=pass header.d=example')],
      ['a quoted MAIL FROM local part whose ) closes Gmail\'s comment and whose ( reopens it around a fake pass (F4)', header('dkim=none', 'spf=softfail (google.com: domain of transitioning "x) ; dkim=pass header.i=@bank.example ; (y"@evil.example does not designate 192.0.2.9 as permitted sender) smtp.mailfrom="x) ; dkim=pass header.i=@bank.example ; (y"@evil.example', 'dmarc=fail header.from=bank.example')],
      ['the same, without the smtp.mailfrom echo (F4b)', header('dkim=none', 'spf=softfail (google.com: domain of transitioning "x) ; dkim=pass header.i=@bank.example ; (y"@evil.example does not designate 192.0.2.9 as permitted sender)', 'dmarc=fail header.from=bank.example')],
      ['a quoted mailfrom carrying ; and a fake pass', header('dkim=none', 'spf=neutral smtp.mailfrom="x;dkim=pass header.i=@bank.example;"@evil.example', 'dmarc=fail header.from=bank.example')],
      ['an escaped backslash before ) inside a comment (F3)', header('dkim=none', 'spf=pass (google.com: x\\) ; dkim=pass header.i=@bank.example ; y) smtp.mailfrom=x@evil.example', 'dmarc=fail header.from=bank.example')],
      ['a stray closing paren with nothing open', header('dkim=pass header.i=@bank.example) header.s=s1')],
      ['a result that merely ends with dkim=pass, not starts with it', header('xdkim=pass header.i=@bank.example')],
      ['a result whose method is not exactly pass', header('dkim=passed header.i=@bank.example')],
      ['a fake header.i hidden inside a header.s value', header('dkim=pass header.s=x.header.i=@bank.example header.i=@evil.example')],
      ['a first, losing header.i ahead of an aligned one', header('dkim=pass header.i=@evil.example header.i=@bank.example')],
      ['a header.i with two @ signs', header('dkim=pass header.i=x@y@bank.example')],
    ])('refuses %s', (_label, hdr) => {
      expect(verifySender(hdr, FROM)).toBe(false);
    });
  });
});

/**
 * Whether Gmail itself vouched for a mail's sender. The From address is
 * trivially forged, so the sender allow-list alone would book a stranger's
 * fake "bank alert". Gmail checks DKIM, SPF and DMARC on receipt and
 * prepends its verdict as the topmost Authentication-Results header; any such
 * header lower down came with the mail and proves nothing. So only the
 * topmost one is read, and only when Gmail (mx.google.com) wrote it.
 *
 * The header can also embed sender-controlled text — the envelope sender in
 * smtp.mailfrom, and DKIM's i=/s=/d= — inside comments or quoted strings,
 * either of which can hold anything, including a fake "pass" or a stray ";".
 * So comments and the insides of quoted strings are stripped first (an
 * unterminated one fails the whole header), each ";"-separated result is then
 * parsed as whole space-separated tokens rather than a substring search, and
 * a repeated header.x keeps only the first occurrence.
 *
 * Passes when DMARC passed for the From domain, or a DKIM signature passed
 * for that domain, its parent, or a subdomain of it.
 */
export function verifySender(authResults: string | undefined, fromAddress: string): boolean {
  if (!authResults || !fromAddress.includes('@')) return false;
  const fromDomain = fromAddress.slice(fromAddress.lastIndexOf('@') + 1).trim().toLowerCase();
  if (!DOMAIN.test(fromDomain)) return false;

  const value = stripCommentsAndQuotes(authResults.replace(/^\s*authentication-results\s*:/i, ''));
  if (value === null) return false;
  const [authserv, ...results] = value.replace(/\s*=\s*/g, '=').split(';').map((part) => part.trim());
  if (authserv.split(/\s+/)[0].toLowerCase() !== 'mx.google.com') return false;

  for (const result of results) {
    const [head, ...tokens] = result.toLowerCase().split(/\s+/);
    const method = /^(dkim|dmarc)=pass$/.exec(head);
    if (!method) continue;
    const props = new Map<string, string>();
    for (const token of tokens) {
      const prop = /^header\.(from|d|i)=(.+)$/.exec(token);
      if (prop && !props.has(prop[1])) props.set(prop[1], prop[2]); // the first one wins
    }
    const identity = /^[^@"]*@([^@]+)$/.exec(props.get('i') ?? '');
    const domain = method[1] === 'dmarc' ? props.get('from') : props.get('d') ?? identity?.[1];
    if (domain && DOMAIN.test(domain) && aligned(domain, fromDomain)) return true;
  }
  return false;
}

/** A domain of at least two labels: letters, digits and inner hyphens only. */
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The header without its comments (nested ones too) and without the insides of
 * quoted strings (kept as ""), with nothing put in their place; null when a
 * comment or quote is left open. Both can carry text the sender chose.
 */
function stripCommentsAndQuotes(s: string): string | null {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') {
        quoted = false;
        out += '""';
      }
      continue;
    }
    if (depth) {
      if (c === '\\') i++;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '(') depth = 1;
    else out += c;
  }
  return quoted || depth ? null : out;
}

/** The same domain, or one is a subdomain of the other (relaxed alignment). */
function aligned(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

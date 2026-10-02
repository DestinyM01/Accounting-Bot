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
 * Gmail echoes the envelope sender inside its comments unescaped, so a quote
 * inside a comment can only be a sender's quoted local part, which can close
 * Gmail's comment early and smuggle a fake result out into the open: such a
 * header is refused. Gmail does quote some values itself (a bounce address
 * with "=" in it, a DKIM fragment with "/"), so a quote is accepted only as a
 * property's whole value whose text holds no space, ";", parenthesis, quote
 * or backslash. A backslash anywhere is refused outright: escaping is the
 * only way a sender's quote or parenthesis could sit inside Gmail's text, and
 * a stray, unmatched ")" is refused the same way, since Gmail's own
 * parentheses always balance. What remains is stripped of its (now certainly
 * Gmail-authored) comments, each ";"-separated result is then parsed as whole
 * space-separated tokens rather than a substring search, and a repeated
 * header.x keeps only the first occurrence.
 *
 * Passes when DMARC passed for the From domain, or a DKIM signature passed
 * for that domain, its parent, or a subdomain of it.
 */
export function verifySender(authResults: string | undefined, fromAddress: string): boolean {
  // A backslash can only escape a quote or parenthesis the sender chose, which
  // could close one of Gmail's comments early; such a mail is just left
  // unverified. Quotes are judged by where they stand (stripCommentsAndQuotes).
  if (!authResults || authResults.includes('\\') || !fromAddress.includes('@')) return false;
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

/** The text of a quoted value Gmail writes itself: an address or a signature fragment. */
const SAFE_QUOTED = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]+$/;

/**
 * The header without its comments (nested ones too), and with each quoted
 * value replaced by its bare text; null when a comment is left open, a ")"
 * turns up with none open, a quote stands inside a comment, or a quote is not
 * a property's whole, safe value (straight after "=", ending before a space,
 * a ";" or the end, its text matching SAFE_QUOTED). Gmail's own text is always
 * balanced and quotes only such values, so any of these means sender text or
 * a header too malformed to trust. Backslashes are refused before this runs.
 */
function stripCommentsAndQuotes(s: string): string | null {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (depth) {
      if (c === '"') return null;
      if (c === '(') depth++;
      else if (c === ')') depth--;
      continue;
    }
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0 || s[i - 1] !== '=') return null;
      const text = s.slice(i + 1, end);
      const next = s[end + 1];
      if (!SAFE_QUOTED.test(text) || (next !== undefined && !/[\s;]/.test(next))) return null;
      out += text;
      i = end;
    } else if (c === '(') depth = 1;
    else if (c === ')') return null;
    else out += c;
  }
  return depth ? null : out;
}

/** The same domain, or one is a subdomain of the other (relaxed alignment). */
function aligned(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

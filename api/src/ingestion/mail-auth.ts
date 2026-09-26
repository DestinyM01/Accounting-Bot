/**
 * Whether Gmail itself vouched for a mail's sender. The From address is
 * trivially forged, so the sender allow-list alone would book a stranger's
 * fake "bank alert". Gmail checks DKIM, SPF and DMARC on receipt and
 * prepends its verdict as the topmost Authentication-Results header; any such
 * header lower down came with the mail and proves nothing. So only the
 * topmost one is read, and only when Gmail (mx.google.com) wrote it.
 *
 * Passes when DMARC passed for the From domain, or a DKIM signature passed
 * for that domain, its parent, or a subdomain of it.
 */
export function verifySender(authResults: string | undefined, fromAddress: string): boolean {
  if (!authResults) return false;
  const fromDomain = fromAddress.split('@')[1]?.trim().toLowerCase();
  if (!fromDomain) return false;

  const value = authResults
    .replace(/^\s*authentication-results\s*:/i, '')
    .replace(/\r?\n[ \t]+/g, ' ') // unfold continuation lines
    .replace(/\([^()]*\)/g, ' '); // drop comments, which may hold anything
  const [authserv, ...results] = value.split(';').map((part) => part.trim());
  if (authserv.split(/\s+/)[0].toLowerCase() !== 'mx.google.com') return false;

  for (const result of results) {
    const method = /^(dkim|dmarc)\s*=\s*([a-z]+)/i.exec(result);
    if (!method || method[2].toLowerCase() !== 'pass') continue;
    const props = new Map(
      [...result.matchAll(/header\.(from|d|i)\s*=\s*"?([^\s";]+)"?/gi)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]),
    );
    const domain =
      method[1].toLowerCase() === 'dmarc'
        ? props.get('from')
        : props.get('d') ?? props.get('i')?.split('@').pop();
    if (domain && aligned(domain, fromDomain)) return true;
  }
  return false;
}

/** The same domain, or one is a subdomain of the other (relaxed alignment). */
function aligned(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

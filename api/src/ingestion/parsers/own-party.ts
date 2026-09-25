/** Escapes regex metacharacters so a fragment is matched literally. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `value` refers to one of the caller's own identifiers. An
 * identifier matches one of three ways, by shape:
 *
 * - All digits (an account last-4): matches on a digit boundary, so '2002'
 *   does not match an unrelated account ending '32002'. Getting this wrong
 *   silently flips a transfer's classification and erases real money from
 *   the ledger.
 * - Digits mixed with letters (a masked account from the server config, e.g.
 *   'XXXXXX2003'): matches anywhere as a plain substring, same as before
 *   whole-word matching existed.
 * - Letters only (a name fragment): matches whole words only (Unicode
 *   letters, combining marks and digits bound a word), so "ana" does not
 *   match inside "MARIANA". Both the value and the identifier are normalised
 *   to NFC first, so an accented letter matches whether it arrived
 *   precomposed or as a base letter plus a combining mark. Words inside a
 *   fragment may be separated by any run of whitespace.
 */
export function matchesOwn(value: string | null | undefined, ownIdentifiers: string[]): boolean {
  if (!value) return false;
  const hay = value.normalize('NFC').toLowerCase();
  return ownIdentifiers.some((raw) => {
    const id = raw.trim().normalize('NFC').toLowerCase();
    if (!id) return false;
    if (/^\d+$/.test(id)) {
      return new RegExp(`(?<!\\d)${id}(?!\\d)`).test(hay);
    }
    if (/\d/.test(id)) {
      return hay.includes(id);
    }
    const words = id.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${words}(?![\\p{L}\\p{M}\\p{N}])`, 'u').test(hay);
  });
}

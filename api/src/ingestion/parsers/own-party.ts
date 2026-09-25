/** Escapes regex metacharacters so a fragment is matched literally. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `value` refers to one of the caller's own identifiers.
 *
 * Numeric identifiers (account last-4) must match on a digit boundary, so
 * '2002' does not match an unrelated account ending '32002'. Getting this
 * wrong silently flips a transfer's classification and erases real money
 * from the ledger.
 *
 * Name fragments match whole words only (Unicode letters and digits bound a
 * word), so "ana" does not match inside "MARIANA". Words inside a fragment
 * may be separated by any run of whitespace.
 */
export function matchesOwn(value: string | null | undefined, ownIdentifiers: string[]): boolean {
  if (!value) return false;
  const hay = value.toLowerCase();
  return ownIdentifiers.some((raw) => {
    const id = raw.trim().toLowerCase();
    if (!id) return false;
    if (/^\d+$/.test(id)) {
      return new RegExp(`(?<!\\d)${id}(?!\\d)`).test(hay);
    }
    const words = id.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'u').test(hay);
  });
}

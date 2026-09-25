/**
 * A bank merchant name reduced to what stays the same between charges:
 * lowercase words, with every token that contains a digit (reference codes
 * such as "2K3JD" or "#1234") dropped. Empty means "no usable key".
 */
export function merchantKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .split(/[\s*#]+/)
    .filter((token) => token && !/\d/.test(token))
    .join(' ');
}

import { PLACEHOLDER_COUNTERPARTIES } from '../ingestion/parsers/types';

/**
 * A bank merchant name reduced to what stays the same between charges:
 * lowercase words, with every token that contains a digit (reference codes
 * such as "2K3JD" or "#1234") dropped.
 */
function merchantWords(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .split(/[\s*#]+/)
    .filter((token) => token && !/\d/.test(token))
    .join(' ');
}

/** Keys that name no merchant: parser placeholders, and generic words left once reference codes are dropped. */
const NOT_A_MERCHANT = new Set([...PLACEHOLDER_COUNTERPARTIES.map((p) => merchantWords(p)), 'pago', 'compra', 'paypal']);

/**
 * A bank merchant name reduced to what stays the same between charges (see
 * merchantWords). Empty means "no usable key": nothing but reference codes,
 * a parser placeholder ("Transferencia", "Desconocido"), or a generic word
 * like "pago" or "paypal" alone.
 */
export function merchantKey(name: string | null | undefined): string {
  const key = merchantWords(name);
  return NOT_A_MERCHANT.has(key) ? '' : key;
}

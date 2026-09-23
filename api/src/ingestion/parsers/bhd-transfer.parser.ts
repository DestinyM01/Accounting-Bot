import { ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyyDash12h } from './dates';
import { matchesOwn } from './own-party';

/** Strips a trailing colon and surrounding whitespace, for exact label comparison. */
function normaliseLabel(cell: string): string {
  return cell.trim().replace(/:\s*$/, '').toLowerCase();
}

/**
 * BHD transfer emails are pipe-delimited label/value rows:
 *   | Producto destino: | XXXXXX4400 |
 * Label and value are separate cells on the SAME line.
 *
 * The label cell must match EXACTLY (after stripping the trailing colon), not
 * merely start with `label` — otherwise a longer label sharing a prefix (e.g.
 * "Monto ITBIS:" vs "Monto:") can silently win and produce a wrong amount.
 */
function fieldValue(body: string, label: string): string | null {
  for (const line of body.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && normaliseLabel(cells[0]) === normaliseLabel(label)) {
      return cells[1] || null;
    }
  }
  return null;
}

/** Returns null when this is not a BHD transfer email at all. */
export function parseBhdTransfer(input: ParseInput): ParsedTransaction | null {
  const { body, ownCashAccounts = [] } = input;

  const tipo = fieldValue(body, 'Tipo de transacción');
  const montoRaw = fieldValue(body, 'Monto');
  if (!tipo || !montoRaw) return null;

  const amount = toAmount(montoRaw.replace(/RD\$|US\$/g, '').trim());
  const occurredAt = parseDdMmYyyyDash12h(fieldValue(body, 'Fecha y hora de la transacción') ?? '');
  if (isNaN(amount) || !occurredAt) return null;

  const destino = fieldValue(body, 'Producto destino');
  const beneficiario = fieldValue(body, 'Beneficiario');

  // Classification is decided ONLY by the destination account. The subject and
  // Tipo de transacción both lie: a real "y a otros Bancos" email moved money
  // between two of the user's own accounts. The beneficiary name lies too — the
  // user's loan account carries their own name.
  let transferKind: 'external' | 'internal' | 'unresolved';
  if (!destino) {
    transferKind = 'unresolved';
  } else if (matchesOwn(destino, ownCashAccounts)) {
    transferKind = 'internal';
  } else {
    transferKind = 'external';
  }

  return {
    bank: 'bhd',
    direction: 'expense',
    amount,
    currency: /US\$/.test(montoRaw) ? 'USD' : 'DOP',
    occurredAt,
    counterparty: beneficiario || 'Transferencia',
    isWithdrawal: false,
    // These emails are receipts of completed transfers; there is no Estado field.
    approved: true,
    externalRef: fieldValue(body, 'Número de confirmación') ?? undefined,
    transferKind,
  };
}

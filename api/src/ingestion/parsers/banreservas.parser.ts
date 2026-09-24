import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseSpanishLongDate } from './dates';
import { matchesOwn } from './own-party';

/** Strips a trailing colon and surrounding whitespace, for exact label comparison. */
function normaliseLabel(line: string): string {
  return line.trim().replace(/:\s*$/, '').toLowerCase();
}

/**
 * Banreservas puts the label on one line and its value on the NEXT line.
 *
 * The label line must match EXACTLY (after stripping the trailing colon), not
 * merely start with `label` — otherwise a longer label sharing a prefix can
 * silently win and hand back the wrong value. Same rule as the BHD parser.
 */
function valueAfter(lines: string[], label: string): string | null {
  const want = normaliseLabel(label);
  const i = lines.findIndex((l) => normaliseLabel(l) === want);
  if (i < 0) return null;
  const v = lines[i + 1];
  return v && !v.endsWith(':') ? v : null;
}

export const banreservasParser: BankParser = {
  bank: 'banreservas',
  senders: ['notificacionestubancoapp@banreservas.com'],

  parse({ body, ownIdentifiers = [], ownCashAccounts = [] }: ParseInput): ParsedTransaction | null {
    const lines = body
      .split('\n')
      .map((l) => l.replace(/\|/g, '').trim())
      .filter(Boolean);

    const montoRaw = valueAfter(lines, 'Monto:');
    const origen   = valueAfter(lines, 'Origen:');
    const destino  = valueAfter(lines, 'Destino:');
    const fechaRaw = valueAfter(lines, 'Fecha de transacción:');
    const refRaw   = valueAfter(lines, 'Número de transacción:');
    if (!montoRaw || !fechaRaw) return null;

    // "DOP 1,225.00"
    const amountM = montoRaw.match(/([A-Z]{3})\s*([\d.,]+)/);
    if (!amountM) return null;
    const amount = toAmount(amountM[2]);
    if (isNaN(amount)) return null;

    const occurredAt = parseSpanishLongDate(fechaRaw);
    if (!occurredAt) return null;

    // Direction is DETECTED, never assumed. Unknown => do not ingest.
    //
    // Whether money ARRIVED in the user's own cash is decided ONLY by the
    // destination account number. The name on the destination never decides:
    // the user's loan carries the user's own name, and a payment to it is an
    // expense, not income. The name fragments in ownIdentifiers answer only
    // "is the sender me?".
    const destIsCash = matchesOwn(destino, ownCashAccounts);
    const origIsOwn = matchesOwn(origen, ownIdentifiers) || matchesOwn(origen, ownCashAccounts);

    const origName = origen?.split(',')[0]?.trim() || 'Transferencia';
    const destName = destino?.split(',')[0]?.trim() || 'Transferencia';

    let direction: 'income' | 'expense';
    let transferKind: 'external' | 'internal';
    let counterparty: string;
    if (destIsCash && origIsOwn) {
      // Own account -> own cash account: a funding move, no money left.
      direction = 'expense';
      transferKind = 'internal';
      counterparty = destName;
    } else if (destIsCash) {
      // A third party paid the user.
      direction = 'income';
      transferKind = 'external';
      counterparty = origName;
    } else if (origIsOwn) {
      // The user paid someone, or their own loan.
      direction = 'expense';
      transferKind = 'external';
      counterparty = destName;
    } else {
      return null;
    }

    return {
      bank: 'banreservas',
      direction,
      amount,
      currency: amountM[1] === 'USD' ? 'USD' : 'DOP',
      occurredAt,
      counterparty,
      isWithdrawal: false,
      approved: true, // the email IS the receipt; no status field exists
      externalRef: refRaw ?? undefined,
      transferKind,
    };
  },
};

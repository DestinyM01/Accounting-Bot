import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseSpanishLongDate } from './dates';

/** Banreservas puts the label on one line and its value on the NEXT line. */
function valueAfter(lines: string[], label: string): string | null {
  const i = lines.findIndex((l) => l.toLowerCase().startsWith(label.toLowerCase()));
  if (i < 0) return null;
  const v = lines[i + 1];
  return v && !v.endsWith(':') ? v : null;
}

function matchesOwn(value: string | null, ownIdentifiers: string[]): boolean {
  if (!value) return false;
  const hay = value.toLowerCase();
  return ownIdentifiers.some((raw) => {
    const id = raw.trim().toLowerCase();
    if (!id) return false;
    // Numeric identifiers (account last-4) must match on a digit boundary, so
    // '2002' does not match an unrelated account ending '32002'. Getting this
    // wrong silently flips the income/expense direction.
    if (/^\d+$/.test(id)) {
      return new RegExp(`(?<!\\d)${id}(?!\\d)`).test(hay);
    }
    return hay.includes(id);
  });
}

export const banreservasParser: BankParser = {
  bank: 'banreservas',
  senders: ['notificacionestubancoapp@banreservas.com'],

  parse({ body, ownIdentifiers = [] }: ParseInput): ParsedTransaction | null {
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
    let direction: 'income' | 'expense';
    let counterparty: string;
    if (matchesOwn(destino, ownIdentifiers)) {
      direction = 'income';
      counterparty = origen?.split(',')[0]?.trim() ?? 'Transferencia';
    } else if (matchesOwn(origen, ownIdentifiers)) {
      direction = 'expense';
      counterparty = destino?.split(',')[0]?.trim() ?? 'Transferencia';
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
    };
  },
};

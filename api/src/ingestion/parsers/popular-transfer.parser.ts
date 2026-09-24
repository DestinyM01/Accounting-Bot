import { ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyy } from './dates';
import { matchesOwn } from './own-party';
import { TransferKind } from '../../shared/schemas/transfer-kind';

/**
 * Popular puts label and value on the SAME line: "Monto: RD$ 20,000.00".
 *
 * The label is anchored to the start of a line or a "|" cell, and the colon
 * is required (not optional) so a longer label sharing a prefix cannot match
 * — e.g. "Monto 2:" must not satisfy a lookup for "Monto", and "Fecha y hora
 * de la transacción:" must not satisfy a lookup for "Fecha".
 */
function inlineValue(body: string, label: string): string | null {
  const re = new RegExp(`(?:^|\\|)\\s*${label}\\s*:\\s*([^|\\n]+)`, 'im');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function parseSent(input: ParseInput): ParsedTransaction | null {
  const { body, ownCashAccounts = [] } = input;

  const montoRaw = inlineValue(body, 'Monto');
  const fechaRaw = inlineValue(body, 'Fecha');
  if (!montoRaw || !fechaRaw) return null;

  const amount = toAmount(montoRaw.replace(/RD\$|US\$|RD\s/g, '').trim());
  const occurredAt = parseDdMmYyyy(fechaRaw);
  if (isNaN(amount) || !occurredAt) return null;

  const beneficiario = inlineValue(body, 'Beneficiario');
  const cuenta = inlineValue(body, 'Cuenta o Producto');

  // Destination account decides, never the beneficiary name.
  const transferKind: TransferKind = !cuenta
    ? 'unresolved'
    : matchesOwn(cuenta, ownCashAccounts)
      ? 'internal'
      : 'external';

  return {
    bank: 'popular',
    direction: 'expense',
    amount,
    currency: /US\$/.test(montoRaw) ? 'USD' : 'DOP',
    occurredAt,
    counterparty: beneficiario || 'Transferencia enviada',
    isWithdrawal: false,
    // "fue enviada satisfactoriamente" is the success signal; there is no Aprobada.
    approved: true,
    transferKind,
  };
}

function parseReceived(input: ParseInput): ParsedTransaction | null {
  // Markdown-style table; the data row is the one carrying a date.
  const row = input.body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('|') && /\d{1,2}\/\d{1,2}\/\d{4}/.test(l) && !/^\|[-|\s]+\|$/.test(l));
  if (!row) return null;

  const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;

  // "RD 2,000.00" — no dollar sign, unlike every other Popular format.
  const amount = toAmount(cells[0].replace(/RD\$|US\$|RD/g, '').trim());
  const occurredAt = parseDdMmYyyy(cells[1]);
  if (isNaN(amount) || !occurredAt) return null;

  return {
    bank: 'popular',
    direction: 'income',
    amount,
    currency: /US\$/.test(cells[0]) ? 'USD' : 'DOP',
    occurredAt,
    // The email names only a channel, never a sender.
    counterparty: 'Transferencia recibida',
    isWithdrawal: false,
    approved: true,
    // Never asserted as income here: with no sender named, this may be the
    // user's own money arriving from another bank, whose sending leg was
    // suppressed as internal. The orchestrator reconciles the two legs.
    transferKind: 'unresolved',
    isReceivedTransfer: true,
  };
}

export function parsePopularTransfer(input: ParseInput): ParsedTransaction | null {
  const subject = input.subject.toLowerCase();
  if (subject.includes('pagos al instante')) return parseSent(input);
  if (subject.includes('transf recibida')) return parseReceived(input);
  return null;
}

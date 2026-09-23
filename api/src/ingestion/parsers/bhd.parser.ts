import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyy12h } from './dates';
import { parseBhdTransfer } from './bhd-transfer.parser';

export const bhdParser: BankParser = {
  bank: 'bhd',
  senders: ['alertas@bhd.com.do'],

  parse(input: ParseInput): ParsedTransaction | null {
    // Discriminate on format BEFORE falling back to the card-table heuristic.
    // That heuristic scans for "any pipe row containing a date", which a
    // transfer email also satisfies — it is rejected today only because the
    // matched row happens to have too few cells. That is an accident, not a
    // decision.
    const transfer = parseBhdTransfer(input);
    if (transfer) return transfer;

    const { body } = input;
    // The data row is the pipe row containing a date (the header row has none).
    const row = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('|') && /\d{1,2}\/\d{1,2}\/\d{4}/.test(l));
    if (!row) return null;

    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 6) return null;
    const [fecha, moneda, monto, comercio, estado, tipo] = cells;

    if (!/aprobada/i.test(estado)) return null;

    const occurredAt = parseDdMmYyyy12h(fecha);
    const amount = toAmount(monto.replace(/\$/g, ''));
    if (!occurredAt || isNaN(amount)) return null;

    const cardM = body.match(/#\s*(\d{4})/);

    return {
      bank: 'bhd',
      direction: 'expense',
      amount,
      currency: /US/i.test(moneda) ? 'USD' : 'DOP',
      occurredAt,
      counterparty: comercio,
      cardLast4: cardM?.[1],
      isWithdrawal: /retiro/i.test(tipo),
      approved: true,
    };
  },
};

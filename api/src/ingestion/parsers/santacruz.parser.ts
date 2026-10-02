import { BankParser, PLACEHOLDER_COUNTERPARTIES, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDMyHms, parseDMyHmsNoMeridiem } from './dates';

/**
 * "TRANSFERENCIA RECIBIDA": money in from another bank, one "Label: value" per
 * line ("* Monto: DOP 500.00"). It names the sender, but booked like Popular's
 * received transfers: never income on its own, since it is often the user's
 * own money from another bank, whose sent leg the orchestrator pairs it with.
 */
function parseReceivedTransfer({ body, arrivedAt }: ParseInput): ParsedTransaction | null {
  if (!/transferencia recibida/i.test(body)) return null;

  const amountM = body.match(/Monto:\s*(DOP|USD|RD\$|US\$)\s*([\d.,]+)/i);
  const dateM = body.match(/Fecha y hora:[^\S\n]*([^\n]+)/i);
  if (!amountM || !dateM) return null;

  const amount = toAmount(amountM[2]);
  const occurredAt = parseDMyHmsNoMeridiem(dateM[1].trim(), arrivedAt);
  if (isNaN(amount) || !occurredAt) return null;

  // Its own line, so "Banco remitente:" (the sending bank) never matches.
  const remitente = body.match(/^[^\S\n]*(?:[*•-][^\S\n]*)?Remitente:[^\S\n]*([^\n]+)/im)?.[1].trim();

  return {
    bank: 'santacruz',
    direction: 'income',
    amount,
    currency: /^(USD|US\$)$/i.test(amountM[1]) ? 'USD' : 'DOP',
    occurredAt,
    counterparty: remitente || 'Transferencia recibida',
    isWithdrawal: false,
    approved: true,
    transferKind: 'unresolved',
    isReceivedTransfer: true,
  };
}

export const santaCruzParser: BankParser = {
  bank: 'santacruz',
  senders: ['notificaciones@bsc.com.do'],

  parse(input: ParseInput): ParsedTransaction | null {
    const transfer = parseReceivedTransfer(input);
    if (transfer) return transfer;

    const { body } = input;
    const estadoM = body.match(/Estado:\s*(\w+)/i);
    if (!estadoM || !/aprobada/i.test(estadoM[1])) return null;

    const amountM = body.match(/Monto:\s*(RD\$|US\$)\s*([\d.,]+)/i);
    const placeM  = body.match(/Lugar de transacci[óo]n:\s*(.+)/i);
    const dateM   = body.match(/Fecha y hora:\s*(.+)/i);
    if (!amountM || !dateM) return null;

    const occurredAt = parseDMyHms(dateM[1].trim());
    if (!occurredAt) return null;

    const cardM = body.match(/terminada en\s*(\d{4})/i);

    return {
      bank: 'santacruz',
      direction: 'expense',
      amount: toAmount(amountM[2]),
      currency: amountM[1] === 'US$' ? 'USD' : 'DOP',
      occurredAt,
      counterparty: placeM?.[1].trim() ?? PLACEHOLDER_COUNTERPARTIES[2], // 'Desconocido': no place named
      cardLast4: cardM?.[1],
      isWithdrawal: /cajero/i.test(placeM?.[1] ?? ''),
      approved: true,
    };
  },
};

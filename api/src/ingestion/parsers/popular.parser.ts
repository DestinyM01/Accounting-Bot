import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyy } from './dates';

export const popularParser: BankParser = {
  bank: 'popular',
  senders: ['notificaciones@popularenlinea.com'],

  parse({ subject, body }: ParseInput): ParsedTransaction | null {
    // Declined mail reuses the "Notificación de Consumo" subject — bail hard.
    if (/declinad/i.test(body)) return null;

    const amountM = body.match(/(RD\$|US\$)\s*([\d.,]+)/);
    const dateM   = body.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const statusM = body.match(/\b(Aprobada)\b/i);
    if (!amountM || !dateM || !statusM) return null;

    const occurredAt = parseDdMmYyyy(dateM[1]);
    if (!occurredAt) return null;

    const isWithdrawal =
      /Retiro/i.test(subject) || /Cajero\s+Autom[áa]tico/i.test(body);

    // Merchant sits between the date and the status word.
    const start = (dateM.index ?? 0) + dateM[1].length;
    const end   = statusM.index ?? body.length;
    const counterparty =
      body.slice(start, end).replace(/[|\t\r\n]+/g, ' ').trim() ||
      (isWithdrawal ? 'Cajero Automatico' : 'Desconocido');

    const cardM = body.match(/terminada en\s*(\d{4})/i);

    return {
      bank: 'popular',
      direction: 'expense',
      amount: toAmount(amountM[2]),
      currency: amountM[1] === 'US$' ? 'USD' : 'DOP',
      occurredAt,
      counterparty,
      cardLast4: cardM?.[1],
      isWithdrawal,
      approved: true,
    };
  },
};

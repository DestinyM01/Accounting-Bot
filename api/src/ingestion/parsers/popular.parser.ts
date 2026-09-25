import { BankParser, PLACEHOLDER_COUNTERPARTIES, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyy } from './dates';
import { parsePopularTransfer } from './popular-transfer.parser';

/**
 * Subjects that arrive from the transaction sender but carry no transaction.
 * They must be recognised explicitly: counting them as parse failures would
 * bury the real failures under monthly noise.
 */
const KNOWN_NON_TRANSACTIONAL = [
  'actualización de límite',
  'actualizacion de limite',
  'depósito de nómina',
  'deposito de nomina',
];

function isNonTransactionalSubject(subject: string): boolean {
  const s = subject.toLowerCase();
  return KNOWN_NON_TRANSACTIONAL.some((k) => s.includes(k));
}

export const popularParser: BankParser = {
  bank: 'popular',
  senders: ['notificaciones@popularenlinea.com'],

  isNonTransactional: ({ subject }: ParseInput) => isNonTransactionalSubject(subject),

  parse(input: ParseInput): ParsedTransaction | null {
    // Defence in depth: even reached directly, these must never yield a
    // transaction. The limit-increase mail is tab-delimited with RD$ amounts,
    // which is exactly the shape the consumption branch below hunts for.
    if (isNonTransactionalSubject(input.subject)) return null;

    const transfer = parsePopularTransfer(input);
    if (transfer) return transfer;

    const { subject, body } = input;
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
      (isWithdrawal ? 'Cajero Automatico' : PLACEHOLDER_COUNTERPARTIES[2]); // 'Desconocido': merchant text not found

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

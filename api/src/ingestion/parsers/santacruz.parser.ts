import { BankParser, PLACEHOLDER_COUNTERPARTIES, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDMyHms } from './dates';

export const santaCruzParser: BankParser = {
  bank: 'santacruz',
  senders: ['notificaciones@bsc.com.do'],

  parse({ body }: ParseInput): ParsedTransaction | null {
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

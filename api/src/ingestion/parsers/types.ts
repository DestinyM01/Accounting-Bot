export type Bank = 'popular' | 'bhd' | 'santacruz' | 'banreservas';

export interface ParsedTransaction {
  bank: Bank;
  direction: 'income' | 'expense';
  amount: number;              // positive magnitude, commas stripped
  currency: 'DOP' | 'USD';
  occurredAt: Date;
  counterparty: string;        // merchant, or the other party on a transfer
  cardLast4?: string;
  isWithdrawal: boolean;
  approved: boolean;
  externalRef?: string;
}

export interface ParseInput {
  subject: string;
  body: string;
  /** Own account last-4s / name fragments, for transfer direction detection. */
  ownIdentifiers?: string[];
}

export interface BankParser {
  readonly bank: Bank;
  /** Exact lowercased sender addresses this parser claims. */
  readonly senders: string[];
  /** Returns null when unusable: declined, unparseable, or direction unknown. */
  parse(input: ParseInput): ParsedTransaction | null;
}

/** "1,225.00" | "91.42" -> number. Returns NaN when unparseable. */
export function toAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

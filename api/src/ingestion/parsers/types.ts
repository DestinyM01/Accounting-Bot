import { TransferKind } from '../../shared/schemas/transfer-kind';

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
  /**
   * How this transfer moves money relative to the user's own accounts.
   * Absent means an ordinary card transaction.
   *   external   — money left to a third party; counts as an expense
   *   internal   — between the user's own cash accounts; no expense, no balance
   *   unresolved — destination could not be parsed; recorded, never asserted
   */
  transferKind?: TransferKind;
  /**
   * True for the receiving side of a transfer whose sender the email does not
   * name. It may be a third party paying the user, or the user's own transfer
   * from another bank — whose sending leg was suppressed as internal. It is
   * recorded as unresolved and reconciled against a sent leg by the
   * orchestrator; it never asserts income on its own.
   */
  isReceivedTransfer?: boolean;
}

export interface ParseInput {
  subject: string;
  body: string;
  /** Own account last-4s / name fragments, for transfer direction detection. */
  ownIdentifiers?: string[];
  /**
   * Last-4 digits of the user's own savings/checking accounts. A transfer whose
   * DESTINATION matches one of these is internal. Deliberately separate from
   * ownIdentifiers, which also contains name fragments: the user's loan account
   * carries their own name, so a name match must never imply internal.
   */
  ownCashAccounts?: string[];
}

export interface BankParser {
  readonly bank: Bank;
  /** Exact lowercased sender addresses this parser claims. */
  readonly senders: string[];
  /** Returns null when unusable: declined, unparseable, or direction unknown. */
  parse(input: ParseInput): ParsedTransaction | null;
  /**
   * True when this email is recognised and deliberately carries no transaction
   * — marketing, or a receipt that states no amount.
   *
   * Deliberately NOT folded into parse()'s return type: "is this a transaction
   * email?" and "parse this transaction" are different questions, and a union
   * return would force every caller and every test to narrow before touching a
   * field.
   *
   * The orchestrator calls this BEFORE parse(). If it is ever forgotten, the
   * mail is merely logged as an unusable parse failure — noisy, but safe.
   */
  readonly isNonTransactional?: (input: ParseInput) => boolean;
}

/** "1,225.00" | "91.42" -> number. Returns NaN when unparseable. */
export function toAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

/** Counterparties the parsers use when the bank names nobody. They identify no merchant. */
export const PLACEHOLDER_COUNTERPARTIES = ['Transferencia', 'Transferencia enviada', 'Desconocido'] as const;

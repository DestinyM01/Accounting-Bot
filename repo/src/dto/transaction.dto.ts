import { TransactionType } from '../type/enum/transactionType.enam';

export class CreateTransactionDto {
  userId: number;
  userName: string;
  transactionName: string;
  transactionType: TransactionType;
  amount: number;
  category?: string;
  recurringId?: string;
  /** The scheduled occurrence this satisfies, as 'YYYY-MM'. Set with recurringId. */
  recurringPeriod?: string;
}

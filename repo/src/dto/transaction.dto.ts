import { TransactionType } from '../type/enum/transactionType.enam';
import { Category } from '../type/enum/category.enum';

export class CreateTransactionDto {
  userId: number;
  userName: string;
  transactionName: string;
  transactionType: TransactionType;
  amount: number;
  category?: Category;
}

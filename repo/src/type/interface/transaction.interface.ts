export interface Transaction {
  _id?: any;
  userName: string;
  userId: number;
  transactionName: string;
  transactionType: 'Доход' | 'Расход';
  amount: number;
  timestamp: Date;
  category?: string;
  __v: number;
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectBot } from 'nestjs-telegraf';
import { BalanceService } from './balance.service';
import { Telegraf } from 'telegraf';
import { TransactionType } from '../type/enum/transactionType.enam';
import { CreateTransactionDto } from '../dto/transaction.dto';
import { IContext, Transaction } from '../type/interface';
import { BUTTONS, DELETE_LAST_MESSAGE, DELETE_LAST_MESSAGE2, PERIOD_NULL } from '../constants';
import { backTranButton, editTransactionListButtons } from '../buttons';

@Injectable()
export class TransactionService {
  private readonly logger: Logger = new Logger(TransactionService.name);
  constructor(
    @InjectModel('Transaction')
    private readonly transactionModel: Model<Transaction>,
    @InjectBot() private readonly bot: Telegraf<IContext>,
    private readonly balanceService: BalanceService,
  ) {}

  async createTransaction(createTransactionDto: CreateTransactionDto): Promise<Transaction> {
    try {
      const transactionType = createTransactionDto.transactionType;
      let amount = createTransactionDto.amount;
      if (transactionType === TransactionType.EXPENSE) {
        amount *= -1;
      }
      const transaction = new this.transactionModel({
        userId: createTransactionDto.userId,
        userName: createTransactionDto.userName,
        transactionName: createTransactionDto.transactionName,
        transactionType,
        amount,
        category: createTransactionDto.category,
      });
      const createdTransaction = await transaction.save();
      this.logger.log(`Created transaction for user ${createTransactionDto.userId}`);
      return createdTransaction;
    } catch (error) {
      this.logger.error('Error creating transaction', error);
      throw error;
    }
  }

  async deleteTransactionById(ctx: IContext, transactionId: string): Promise<void> {
    const userId = ctx.from.id;
    try {
      const transaction = await this.transactionModel.findOne({ _id: transactionId, userId }).exec();

      if (!transaction) {
        this.logger.log(`Transaction not found for ID: ${transactionId}`);
        await this.bot.telegram.editMessageText(
          userId,
          ctx.session.lastBotMessage,
          null,
          PERIOD_NULL[ctx.session.language],
        );
        return;
      }
      await this.balanceService.reverseTransaction(
        userId,
        transaction.amount,
        transaction.transactionName,
        transactionId,
      );
      await this.transactionModel.deleteOne({ _id: transactionId }).exec();

      this.logger.log(`Deleted transaction with ID: ${transactionId}`);
    } catch (error) {
      this.logger.error(`Error in deleteTransactionById: ${error}`);
      throw error;
    }
  }
  async showLastNTransactionsWithDeleteOption(ctx: IContext, count: number): Promise<void> {
    const language = ctx.session.language;
    const userId = ctx.from.id;
    try {
      const transactions = await this.transactionModel.find({ userId }).sort({ timestamp: -1 }).limit(count).exec();

      if (transactions.length === 0) {
        await ctx.editMessageText(DELETE_LAST_MESSAGE2[language], backTranButton(ctx.session.language || 'en'));
        return;
      }

      const buttons = transactions.map((transaction) => [
        {
          text: `${transaction.transactionName} : ${transaction.amount}`,
          callback_data: `delete_${transaction._id}`,
        },
      ]);
      buttons.push([
        {
          text: BUTTONS[language].BACK,
          callback_data: 'backT',
        },
      ]);

      await ctx.editMessageText(DELETE_LAST_MESSAGE[language], {
        reply_markup: {
          inline_keyboard: buttons,
        },
      });
    } catch (error) {
      this.logger.error('Error in showLastNTransactionsWithDeleteOption', error);
      throw error;
    }
  }
  async setCategoryById(transactionId: string, category: string): Promise<void> {
    await this.transactionModel.findByIdAndUpdate(transactionId, { category }).exec();
  }

  async searchTransactions(userId: number, keyword: string, groupIds?: number[]): Promise<Transaction[]> {
    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex chars
    const regex = new RegExp(safeKeyword, 'i');
    const query =
      groupIds && groupIds.length > 0
        ? { userId: { $in: [...groupIds, userId] }, transactionName: regex }
        : { userId, transactionName: regex };
    return this.transactionModel.find(query).sort({ timestamp: -1 }).limit(30).exec();
  }

  async deleteAllTransactionsOfUser(userId: number): Promise<void> {
    try {
      await this.transactionModel.deleteMany({ userId }).exec();
      this.logger.log(`Deleted all transactions for user ${userId}`);
    } catch (error) {
      this.logger.error('Error deleting all transactions for user', error);
      throw error;
    }
  }

  /** Shows last N transactions as inline buttons for editing. */
  async showLastNTransactionsWithEditOption(ctx: IContext, count: number): Promise<void> {
    const language = ctx.session.language || 'en';
    const userId = ctx.from.id;
    try {
      const transactions = await this.transactionModel
        .find({ userId })
        .sort({ timestamp: -1 })
        .limit(count)
        .exec();

      if (transactions.length === 0) {
        await ctx.editMessageText(
          DELETE_LAST_MESSAGE2[language] ?? DELETE_LAST_MESSAGE2['en'],
          backTranButton(language),
        );
        return;
      }

      const EDIT_SELECT: Record<string, string> = {
        en: '✏️ Select a transaction to edit:',
        es: '✏️ Selecciona una transacción para editar:',
        ua: '✏️ Оберіть транзакцію для редагування:',
        pl: '✏️ Wybierz transakcję do edycji:',
      };

      await ctx.editMessageText(
        EDIT_SELECT[language] ?? EDIT_SELECT['en'],
        editTransactionListButtons(
          transactions.map((t) => ({ _id: t._id, transactionName: t.transactionName, amount: t.amount })),
          language,
        ),
      );
    } catch (error) {
      this.logger.error('Error in showLastNTransactionsWithEditOption', error);
      throw error;
    }
  }

  /** Fetches a single transaction (scoped to userId). Returns null if not found. */
  async getTransactionById(userId: number, txId: string) {
    return this.transactionModel.findOne({ _id: txId, userId }).exec();
  }

  /** Updates only the name of a transaction. No balance change needed. */
  async updateTransactionName(userId: number, txId: string, newName: string): Promise<void> {
    await this.transactionModel
      .findOneAndUpdate({ _id: txId, userId }, { transactionName: newName.toLowerCase().trim() })
      .exec();
    this.logger.log(`Updated name for transaction ${txId} (user ${userId})`);
  }

  /**
   * Updates the amount of a transaction and adjusts the user's balance.
   * Reverses old balance effect, updates DB with new signed amount, reapplies new amount.
   */
  async updateTransactionAmount(userId: number, txId: string, newRawAmount: number): Promise<void> {
    const tx = await this.transactionModel.findOne({ _id: txId, userId }).exec();
    if (!tx) {
      this.logger.warn(`Transaction ${txId} not found for user ${userId} during amount update`);
      return;
    }
    // Reverse old balance effect (storedAmount has sign: expense=-n, income=+n)
    await this.balanceService.reverseTransaction(userId, tx.amount, tx.transactionName, txId);

    // New stored amount carries the sign
    const newStoredAmount =
      tx.transactionType === TransactionType.EXPENSE ? -Math.abs(newRawAmount) : Math.abs(newRawAmount);

    // Persist the new amount
    await this.transactionModel.findByIdAndUpdate(txId, { amount: newStoredAmount }).exec();

    // Apply new positive amount to balance (updateBalance handles sign via type)
    await this.balanceService.updateBalance(userId, newRawAmount, tx.transactionType as TransactionType, tx.transactionName, txId);

    this.logger.log(`Updated amount for transaction ${txId}: ${newStoredAmount}`);
  }
}

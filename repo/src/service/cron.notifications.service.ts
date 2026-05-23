import { Balance } from '../mongodb/shemas/balance.shemas';
import { Budget } from '../mongodb/shemas/budget.shemas';
import { Injectable, Logger } from '@nestjs/common';
import { IContext, Transaction } from '../type/interface';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { CRON_NOTIFICATION } from '../constants';
import { Telegraf } from 'telegraf';
import { InjectBot } from 'nestjs-telegraf';
import { backToStartButton } from '../battons';
import { TransactionType } from '../type/enum/transactionType.enam';

@Injectable()
export class CronNotificationsService {
  private readonly logger: Logger = new Logger(CronNotificationsService.name);
  private notificationCount: number = 0;
  constructor(
    @InjectBot()
    private readonly bot: Telegraf<IContext>,
    @InjectModel('Balance') private readonly balanceModel: Model<Balance>,
    @InjectModel('Transaction') private readonly transactionModel: Model<Transaction>,
    @InjectModel('Budget') private readonly budgetModel: Model<Budget>,
  ) {}

  @Cron(process.env.CRON_SCHEDULE || '47 15 * * *', { timeZone: process.env.CRON_TIMEZONE || 'America/Santo_Domingo' })
  async notificationsAll() {
    const startTime = new Date();
    this.logger.log(`Cron task started at: ${startTime}`);

    try {
      const inactiveUsers = await this.getInactiveUsers();
      for (const user of inactiveUsers) {
        await this.sendNotification(user);
        await this.deductPremiumFromBalance(user);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      this.logger.error('Error in notificationsAll', error);
    } finally {
      const endTime = new Date();
      const elapsedTime = endTime.getTime() - startTime.getTime();
      this.logger.log(
        `Cron task finished at: ${endTime}, elapsed time: ${elapsedTime} ms, sent ${this.notificationCount} notifications`,
      );
    }
  }

  // ─── Monthly summary — runs at 09:00 on the 1st of each month ───────────────
  @Cron('0 9 1 * *', { timeZone: process.env.CRON_TIMEZONE || 'America/Santo_Domingo' })
  async monthlySummary() {
    const now = new Date();
    // Calculate the previous month
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // Jan(0)→12, else current-1
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const startOfPrevMonth = new Date(prevYear, prevMonth - 1, 1, 0, 0, 0, 0);
    const endOfPrevMonth = new Date(prevYear, prevMonth, 0, 23, 59, 59, 999);

    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const CATEGORY_EMOJI: Record<string, string> = {
      food: '🍔', transport: '🚌', housing: '🏠', health: '💊',
      entertainment: '🎬', salary: '💼', savings: '🏦', other: '📌',
    };

    this.logger.log(`Monthly summary cron: ${MONTH_NAMES[prevMonth - 1]} ${prevYear}`);
    const activeUsers = await this.balanceModel.find({ isBaned: { $ne: true } }).exec();
    let sent = 0;

    for (const user of activeUsers) {
      try {
        const transactions = await this.transactionModel
          .find({ userId: user.userId, timestamp: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } })
          .exec();
        if (transactions.length === 0) continue;

        const income = transactions
          .filter((t) => t.transactionType === TransactionType.INCOME)
          .reduce((s, t) => s + t.amount, 0);
        // Expenses are stored as negative numbers — Math.abs gives the display value
        const expensesRaw = transactions
          .filter((t) => t.transactionType === TransactionType.EXPENSE)
          .reduce((s, t) => s + t.amount, 0);
        const expenses = Math.abs(expensesRaw);
        const net = income - expenses;

        const lang = user.language || 'en';
        const catTotals: Record<string, number> = {};
        for (const t of transactions) {
          if (t.transactionType === TransactionType.EXPENSE && t.category) {
            catTotals[t.category] = (catTotals[t.category] || 0) + Math.abs(t.amount);
          }
        }
        const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

        const LABELS: Record<string, Record<string, string>> = {
          en: { header: 'Monthly Summary', income: 'Income', expenses: 'Expenses', net: 'Net', topCats: 'Top Expense Categories', footer: 'Keep tracking your finances!' },
          es: { header: 'Resumen mensual', income: 'Ingresos', expenses: 'Gastos', net: 'Neto', topCats: 'Principales categorías de gasto', footer: '¡Sigue registrando tus finanzas!' },
          ua: { header: 'Місячний підсумок', income: 'Доходи', expenses: 'Витрати', net: 'Баланс', topCats: 'Топ категорії витрат', footer: 'Продовжуй відстежувати свої фінанси!' },
          pl: { header: 'Miesięczne podsumowanie', income: 'Przychody', expenses: 'Wydatki', net: 'Netto', topCats: 'Główne kategorie wydatków', footer: 'Śledź swoje finanse regularnie!' },
        };
        const L = LABELS[lang] ?? LABELS.en;

        let msg = `📊 <b>${L.header} — ${MONTH_NAMES[prevMonth - 1]} ${prevYear}</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `💵 ${L.income}: <b>${fmt(income)}</b>\n`;
        msg += `💸 ${L.expenses}: <b>${fmt(expenses)}</b>\n`;
        msg += `💰 ${L.net}: <b>${net >= 0 ? '+' : ''}${fmt(net)}</b>\n`;
        if (topCats.length > 0) {
          msg += `\n📑 <b>${L.topCats}:</b>\n`;
          for (const [cat, amount] of topCats) {
            msg += `  ${CATEGORY_EMOJI[cat] ?? '📌'} ${cat}: ${fmt(amount)}\n`;
          }
        }
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `📈 ${L.footer}`;

        await this.bot.telegram.sendMessage(user.userId, msg, { parse_mode: 'HTML' });
        sent++;
        await new Promise((r) => setTimeout(r, 300));
      } catch (error) {
        if (error.code === 403) await this.markUserAsBanned(user);
        this.logger.error(`Error sending monthly summary to user ${user.userId}`, error);
      }
    }
    this.logger.log(`Monthly summary sent to ${sent} users`);
  }

  // ─── Proactive budget alerts — runs daily at 20:00 ───────────────────────
  @Cron('0 20 * * *', { timeZone: process.env.CRON_TIMEZONE || 'America/Santo_Domingo' })
  async proactiveBudgetCheck() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const allBudgets = await this.budgetModel.find({ month, year }).exec();
    if (!allBudgets.length) return;

    // Group budgets by userId
    const byUser = new Map<number, typeof allBudgets>();
    for (const b of allBudgets) {
      if (!byUser.has(b.userId)) byUser.set(b.userId, []);
      byUser.get(b.userId).push(b);
    }

    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    let alertsSent = 0;

    const BUDGET_EXCEEDED: Record<string, string> = {
      en: 'Budget Exceeded!', es: '¡Presupuesto excedido!', ua: 'Бюджет перевищено!', pl: 'Budżet przekroczony!',
    };
    const BUDGET_WARNING: Record<string, string> = {
      en: 'Budget Warning', es: 'Advertencia de presupuesto', ua: 'Попередження про бюджет', pl: 'Ostrzeżenie o budżecie',
    };
    const BUDGET_SPENT: Record<string, string> = {
      en: 'spent', es: 'gastado', ua: 'витрачено', pl: 'wydano',
    };
    const BUDGET_OF: Record<string, string> = {
      en: 'of', es: 'de', ua: 'з', pl: 'z',
    };
    const BUDGET_USED: Record<string, string> = {
      en: 'used this month', es: 'usado este mes', ua: 'використано цього місяця', pl: 'wykorzystano w tym miesiącu',
    };

    for (const [userId, budgets] of byUser) {
      const balanceDoc = await this.balanceModel.findOne({ userId }).exec();
      if (balanceDoc?.isBaned) continue;
      const lang = balanceDoc?.language || 'en';

      for (const budget of budgets) {
        const txs = await this.transactionModel
          .find({
            userId,
            category: budget.category,
            transactionType: TransactionType.EXPENSE,
            timestamp: { $gte: startOfMonth, $lte: endOfMonth },
          })
          .exec();

        const spent = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
        const pct = Math.round((spent / budget.limitAmount) * 100);
        let msg: string | null = null;

        if (spent > budget.limitAmount) {
          msg =
            `🚨 <b>${BUDGET_EXCEEDED[lang] ?? BUDGET_EXCEEDED.en}</b>\n` +
            `<b>${budget.category}</b>: ${BUDGET_SPENT[lang] ?? BUDGET_SPENT.en} <b>${fmt(spent)}</b> ${BUDGET_OF[lang] ?? BUDGET_OF.en} <b>${fmt(budget.limitAmount)}</b> (${pct}%)`;
        } else if (pct >= 80) {
          msg =
            `⚠️ <b>${BUDGET_WARNING[lang] ?? BUDGET_WARNING.en} (${pct}%)</b>\n` +
            `<b>${budget.category}</b>: ${fmt(spent)} / ${fmt(budget.limitAmount)} ${BUDGET_USED[lang] ?? BUDGET_USED.en}`;
        }

        if (msg) {
          try {
            await this.bot.telegram.sendMessage(userId, msg, { parse_mode: 'HTML' });
            alertsSent++;
          } catch (err) {
            if (err.code === 403 && balanceDoc) await this.markUserAsBanned(balanceDoc);
            this.logger.error(`Error sending budget alert to user ${userId}`, err);
          }
        }
      }
    }
    this.logger.log(`Proactive budget check complete — ${alertsSent} alerts sent`);
  }

  private async getInactiveUsers(): Promise<Balance[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 72); // to everyone who is not active
    return await this.balanceModel
      .find({
        $or: [
          { lastActivity: { $lt: cutoffDate }, isBaned: { $ne: true } },
          { lastActivity: { $exists: false }, isBaned: { $ne: true } },
        ],
      })
      .exec();
  }

  private async sendNotification(user: Balance) {
    try {
      const userId = user.userId;
      await this.bot.telegram.sendMessage(userId, CRON_NOTIFICATION, {
        parse_mode: 'HTML',
        reply_markup: backToStartButton().reply_markup,
      });
      this.logger.log(`Sent notification to user ${userId}`);
      this.notificationCount++;
    } catch (error) {
      if (error.code === 403) {
        await this.markUserAsBanned(user);
      }
      this.logger.error(`Error sending notification to user ${user.userId}`, error);
    }
  }

  private async markUserAsBanned(user: Balance) {
    try {
      user.isBaned = true;
      await user.save();
      this.logger.log(`Marked user ${user.userId} as banned`);
    } catch (error) {
      this.logger.error(`Error marking user ${user.userId} as banned`, error);
    }
  }

  private async deductPremiumFromBalance(user: Balance) {
    try {
      if (user.dayOfPremium <= new Date()) {
        user.isPremium = false;

        await user.save();
        this.logger.log(`Deducted premium from balance for user ${user.userId}`);
      } else return;
    } catch (error) {
      this.logger.error(`Error deducting premium from balance for user ${user.userId}`, error);
    }
  }
}

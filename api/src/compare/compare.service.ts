import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Mistral } from '@mistralai/mistralai';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface PeriodSummary {
  month: string;
  totalIncome: number;
  totalExpenses: number;
  net: number;
  topCategories: { category: string; amount: number }[];
}

export interface CompareResult {
  monthA:   PeriodSummary;
  monthB:   PeriodSummary;
  analysis: string;
}

@Injectable()
export class CompareService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private client: Mistral | null = null;

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
  ) {
    if (process.env.MISTRAL_API_KEY) {
      this.client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
    }
  }

  async getAvailableMonths(): Promise<string[]> {
    const results = await this.txModel.aggregate([
      { $match: { userId: this.userId } },
      {
        $group: {
          _id: { year: { $year: '$timestamp' }, month: { $month: '$timestamp' } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);
    return results.map(r =>
      `${r._id.year}-${String(r._id.month).padStart(2, '0')}`
    );
  }

  async compare(monthA: string, monthB: string): Promise<CompareResult> {
    const [summaryA, summaryB] = await Promise.all([
      this.buildPeriodSummary(monthA),
      this.buildPeriodSummary(monthB),
    ]);
    const analysis = await this.callMistral(summaryA, summaryB);
    return { monthA: summaryA, monthB: summaryB, analysis };
  }

  private async buildPeriodSummary(month: string): Promise<PeriodSummary> {
    const [year, m] = month.split('-').map(Number);
    const start = new Date(year, m - 1, 1);
    const end   = new Date(year, m,     1);

    const txs = await this.txModel
      .find({ userId: this.userId, timestamp: { $gte: start, $lt: end } })
      .select('amount category')
      .lean();

    const totalIncome   = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    const catMap: Record<string, number> = {};
    for (const t of txs.filter(t => t.amount < 0)) {
      const cat = t.category || 'other';
      catMap[cat] = (catMap[cat] || 0) + Math.abs(t.amount);
    }
    const topCategories = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, amount]) => ({ category, amount }));

    return { month, totalIncome, totalExpenses, net: totalIncome - totalExpenses, topCategories };
  }

  private async callMistral(a: PeriodSummary, b: PeriodSummary): Promise<string> {
    if (!this.client) throw new InternalServerErrorException('MISTRAL_API_KEY is not configured');

    const fmt = (s: PeriodSummary) =>
      `${s.month}: Income $${s.totalIncome.toFixed(2)}, Expenses $${s.totalExpenses.toFixed(2)}, Net $${s.net.toFixed(2)}` +
      (s.topCategories.length
        ? `. Top: ${s.topCategories.map(c => `${c.category} $${c.amount.toFixed(2)}`).join(', ')}`
        : '');

    const prompt = `You are a personal finance advisor. Compare these two months and give 3-4 sentences of specific, actionable advice:\n\nPeriod A — ${fmt(a)}\nPeriod B — ${fmt(b)}`;

    try {
      const response = await this.client.chat.complete({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
      });
      return (response.choices?.[0]?.message?.content as string) ?? '';
    } catch (err) {
      throw new InternalServerErrorException('Failed to generate comparison');
    }
  }
}

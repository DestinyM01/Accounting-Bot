import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Mistral } from '@mistralai/mistralai';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface Tip {
  title: string;
  description: string;
  category: string;
  icon: string;
  priority: 'high' | 'medium' | 'low';
  potentialSaving?: string;
}

const SYSTEM_PROMPT = `You are a personal finance advisor built into an accounting app.
Analyze the user's spending data for the last 3 months and return 4-5 actionable, personalized financial tips.

Return ONLY valid JSON — a plain array (not wrapped in an object) of tip objects with these exact fields:
- title: string (max 8 words, specific to their numbers)
- description: string (2-3 sentences referencing actual dollar amounts from their data)
- category: string (the relevant spending category, or "general")
- icon: string (Google Material Icon name — e.g. "restaurant", "home", "directions_car", "medical_services", "movie", "savings", "shopping_cart", "payments", "trending_down", "lightbulb")
- priority: "high" | "medium" | "low"
- potentialSaving: string (optional — e.g. "$80/month"; include only when you can derive it from the data)

Sort tips by priority descending. Focus on specific, actionable advice tied to actual numbers.`;

@Injectable()
export class TipsService {
  private readonly logger = new Logger(TipsService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private client: Mistral | null = null;
  private cache: { tips: Tip[]; expiresAt: number } | null = null;
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
  ) {
    if (process.env.MISTRAL_API_KEY) {
      this.client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
    }
  }

  async getTips(): Promise<Tip[]> {
    if (!this.client) {
      throw new InternalServerErrorException('MISTRAL_API_KEY is not configured');
    }
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.tips;
    }
    const context = await this.buildSpendingContext();
    const tips    = await this.callMistral(context);
    this.cache    = { tips, expiresAt: Date.now() + this.CACHE_TTL };
    return tips;
  }

  /** Refreshes past the cache — used by the explicit refresh action */
  async refreshTips(): Promise<Tip[]> {
    this.cache = null;
    return this.getTips();
  }

  private async buildSpendingContext(): Promise<string> {
    const now    = new Date();
    const blocks: string[] = [];

    // Last 3 calendar months of expenses by category
    for (let i = 2; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = d;
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const label = d.toLocaleString('en', { month: 'long', year: 'numeric' });

      const txs = await this.txModel
        .find({ userId: this.userId, timestamp: { $gte: start, $lt: end }, amount: { $lt: 0 } })
        .select('amount category')
        .lean();

      const grouped: Record<string, number> = {};
      for (const t of txs) {
        const cat = t.category || 'other';
        grouped[cat] = (grouped[cat] || 0) + Math.abs(t.amount);
      }

      const lines = Object.entries(grouped)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`)
        .join('\n');

      blocks.push(`${label}:\n${lines || '  (no expenses recorded)'}`);
    }

    // Average monthly income over the same 3-month window
    const since = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const incomeTxs = await this.txModel
      .find({ userId: this.userId, timestamp: { $gte: since }, amount: { $gt: 0 } })
      .select('amount')
      .lean();
    const avgIncome = incomeTxs.reduce((s, t) => s + t.amount, 0) / 3;

    return [
      `Average monthly income (last 3 months): $${avgIncome.toFixed(2)}`,
      '',
      'Monthly expense breakdown:',
      '',
      blocks.join('\n\n'),
    ].join('\n');
  }

  private async callMistral(context: string): Promise<Tip[]> {
    try {
      const response = await this.client!.chat.complete({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: context },
        ],
      });

      const text = (response.choices?.[0]?.message?.content as string) ?? '';

      // Extract JSON array from anywhere in the response (handles prose wrappers + code fences)
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) {
        this.logger.error(`No JSON array in Mistral response. Raw (first 400 chars): ${text.slice(0, 400)}`);
        throw new InternalServerErrorException('Failed to generate financial tips');
      }
      return JSON.parse(match[0]) as Tip[];
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error('callMistral failed', err instanceof Error ? err.stack : String(err));
      throw new InternalServerErrorException('Failed to generate financial tips');
    }
  }
}

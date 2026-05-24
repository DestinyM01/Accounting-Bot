import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
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
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private client: Anthropic | null = null;
  private cache: { tips: Tip[]; expiresAt: number } | null = null;
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
  ) {
    // Only init client if key is present — prevents crash on startup if key not yet set
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  }

  async getTips(): Promise<Tip[]> {
    if (!this.client) {
      throw new InternalServerErrorException('ANTHROPIC_API_KEY is not configured');
    }
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.tips;
    }
    const context = await this.buildSpendingContext();
    const tips    = await this.callClaude(context);
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

  private async callClaude(context: string): Promise<Tip[]> {
    try {
      const response = await this.client!.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 1500,
        thinking: { type: 'adaptive' },
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },  // static prompt — cache it
          },
        ] as any,
        messages: [{ role: 'user', content: context }],
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('');

      // Strip markdown code fence if Claude wraps the JSON
      const json = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(json) as Tip[];
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException('Failed to generate financial tips');
    }
  }
}

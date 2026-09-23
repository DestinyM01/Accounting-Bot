import { Injectable, Logger } from '@nestjs/common';
import { Mistral } from '@mistralai/mistralai';

export interface CategoryResult {
  category: string;
  needsReview: boolean;
}

/** Deterministic rules run first — free, instant, and predictable. */
const RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /uber\s*\*?\s*eats|pedidosya|didi\s*food/i, category: 'food' },
  { pattern: /uber|didi|taxi|parqueo|gasolin|shell|texaco/i, category: 'transport' },
  { pattern: /supermercado|nacional|jumbo|sirena|bravo|pricesmart/i, category: 'food' },
  { pattern: /farmacia|carol|gbc|hospital|clinic/i, category: 'health' },
  { pattern: /edenorte|edesur|edeeste|claro|altice|viva|agua/i, category: 'housing' },
  { pattern: /netflix|spotify|hbo|disney|cine|steam/i, category: 'entertainment' },
  { pattern: /cajero\s+autom/i, category: 'other' },
];

@Injectable()
export class CategorizerService {
  private readonly logger = new Logger(CategorizerService.name);
  private client: Mistral | null = null;

  /** Rules first; Mistral only for unknown merchants. */
  async categorize(counterparty: string, allowed: string[]): Promise<CategoryResult> {
    for (const rule of RULES) {
      if (rule.pattern.test(counterparty)) {
        return { category: rule.category, needsReview: false };
      }
    }
    const guess = await this.askMistral(counterparty, allowed);
    return guess
      ? { category: guess, needsReview: true }
      : { category: 'other', needsReview: true };
  }

  private async askMistral(counterparty: string, allowed: string[]): Promise<string | null> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) return null;
    try {
      this.client ??= new Mistral({ apiKey });
      const res = await this.client.chat.complete({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content:
              `Classify this Dominican Republic merchant into exactly one category.\n` +
              `Merchant: "${counterparty}"\n` +
              `Allowed categories: ${allowed.join(', ')}\n` +
              `Reply with ONLY the category name, nothing else.`,
          },
        ],
      });
      const raw = res.choices?.[0]?.message?.content;
      const text = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
      return allowed.includes(text) ? text : null;
    } catch (err) {
      this.logger.error('Mistral categorization failed', err instanceof Error ? err.stack : String(err));
      return null;
    }
  }
}

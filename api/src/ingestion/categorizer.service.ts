import { Injectable, Logger } from '@nestjs/common';
import { Mistral } from '@mistralai/mistralai';

export interface CategoryResult {
  category: string;
  needsReview: boolean;
}

/**
 * Deterministic rules run first — free, instant, and predictable.
 * Each alternation starts at a word boundary so a keyword cannot match inside
 * a longer word ('cine' in MEDICINE, 'agua' in AGUACATE). Stems carry \w* so
 * Spanish suffixes and plurals still match (GASOLINERA, CLINICA, CINEMARK,
 * TAXIS, PARQUEOS) and one-word brand+suffix card descriptors still match
 * (HBOMAX, DISNEYPLUS, STEAMGAMES.COM). \w*clinic\w* also matches a compound
 * with a leading prefix (POLICLINICA), where a leading \b would fail because
 * the boundary sits before POLI, not before CLINIC. Bare 'nacional'
 * is deliberately absent: BANCO NACIONAL is a whole word no boundary can exclude.
 */
const RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /\b(?:uber\s*\*?\s*eats|pedidosya|didi\s*food)\b/i, category: 'food' },
  { pattern: /\b(?:uber|didi|taxi\w*|parqueo\w*|gasolin\w*|shell|texaco)\b/i, category: 'transport' },
  { pattern: /\b(?:supermercado\w*|jumbo|sirena|bravo|pricesmart)\b/i, category: 'food' },
  { pattern: /\b(?:farmacia\w*|carol|gbc|hospital\w*|\w*clinic\w*)\b/i, category: 'health' },
  { pattern: /\b(?:edenorte|edesur|edeeste|claro|altice|viva|agua)\b/i, category: 'housing' },
  { pattern: /\b(?:netflix|spotify|hbo\w*|disney\w*|cine\w*|steam\w*)\b/i, category: 'entertainment' },
  { pattern: /\bcajero\s+autom\w*/i, category: 'other' },
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
      // Return the caller's canonical spelling: custom categories keep their case
      // ('Gym'), and a lowercased reply must map back to it or it can never be assigned.
      const hit = allowed.find((a) => a.toLowerCase() === text);
      return hit ?? null;
    } catch (err) {
      this.logger.error('Mistral categorization failed', err instanceof Error ? err.stack : String(err));
      return null;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const BASE_URL = 'https://open.er-api.com/v6/latest';

@Injectable()
export class CurrencyService {
  private readonly logger: Logger = new Logger(CurrencyService.name);
  private ratesCache: Record<string, number> = {};
  private cacheUpdatedAt: Date | null = null;

  private async fetchRates(baseCurrency: string): Promise<Record<string, number>> {
    const now = new Date();
    if (this.cacheUpdatedAt && now.getTime() - this.cacheUpdatedAt.getTime() < 3_600_000) {
      return this.ratesCache;
    }
    try {
      const response = await axios.get<{ rates: Record<string, number> }>(`${BASE_URL}/${baseCurrency}`);
      this.ratesCache = response.data.rates;
      this.cacheUpdatedAt = now;
      this.logger.log(`Currency rates refreshed (base: ${baseCurrency})`);
      return this.ratesCache;
    } catch (err) {
      this.logger.error('Failed to fetch currency rates', err);
      return this.ratesCache;
    }
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    if (from === to) return amount;
    const rates = await this.fetchRates(from);
    const rate = rates[to];
    if (!rate) {
      this.logger.warn(`No rate found for ${from} -> ${to}`);
      return amount;
    }
    return parseFloat((amount * rate).toFixed(2));
  }

  async getRate(from: string, to: string): Promise<number> {
    if (from === to) return 1;
    const rates = await this.fetchRates(from);
    return rates[to] ?? 1;
  }

  async getAvailableCurrencies(): Promise<string[]> {
    const rates = await this.fetchRates('USD');
    return Object.keys(rates);
  }

  async getCurrencyData(): Promise<{ currencyCode: string; currencyName: string; buyRate: string; sellRate: string }[]> {
    const DISPLAY = ['USD', 'EUR', 'GBP', 'PLN', 'UAH', 'BTC', 'ETH', 'CHF', 'JPY', 'CNY'];
    const rates = await this.fetchRates('USD');
    return DISPLAY.filter((c) => c !== 'USD' && rates[c]).map((code) => ({
      currencyCode: code,
      currencyName: code,
      buyRate: (1 / rates[code]).toFixed(4),
      sellRate: rates[code].toFixed(4),
    }));
  }
}

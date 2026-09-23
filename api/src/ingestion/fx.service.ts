import { Injectable, Logger } from '@nestjs/common';

const ONE_HOUR = 3_600_000;

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private cached: number | null = null;
  private cachedAt = 0;

  /** USD -> DOP. Falls back to USD_DOP_RATE env, then a conservative default. */
  async usdToDop(amount: number): Promise<number> {
    const rate = await this.getRate();
    return Math.round(amount * rate * 100) / 100;
  }

  private async getRate(): Promise<number> {
    if (this.cached && Date.now() - this.cachedAt < ONE_HOUR) return this.cached;
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json.rates?.DOP;
      if (rate && rate > 0) {
        this.cached = rate;
        this.cachedAt = Date.now();
        return rate;
      }
    } catch (err) {
      this.logger.warn(`FX fetch failed, using fallback rate: ${String(err)}`);
    }
    return parseFloat(process.env.USD_DOP_RATE || '') || 60;
  }
}

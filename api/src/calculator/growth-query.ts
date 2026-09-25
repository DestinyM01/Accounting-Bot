import { BadRequestException } from '@nestjs/common';
import { GrowthInput } from './compound-growth';

const MAX_AMOUNT = 1e12;

/** The calculator's query, validated. Every problem is a 400 with a message the page shows as is. */
export function parseGrowthQuery(q: Record<string, unknown>): GrowthInput {
  const num = (name: string, label: string): number => {
    const raw = q[name];
    const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(v)) throw new BadRequestException(`${label} must be a number`);
    return v;
  };
  const start = num('start', 'The starting amount');
  const monthly = num('monthly', 'The monthly deposit');
  const rate = num('rate', 'The rate');
  const years = num('years', 'Years');

  if (start < 0 || monthly < 0) throw new BadRequestException('Amounts can’t be negative');
  if (start > MAX_AMOUNT || monthly > MAX_AMOUNT) throw new BadRequestException('Amounts must be at most 1,000,000,000,000');
  if (start === 0 && monthly === 0) throw new BadRequestException('Enter a starting amount or a monthly deposit');
  if (rate < 0 || rate > 100) throw new BadRequestException('The rate must be from 0 to 100%');
  if (!Number.isInteger(years) || years < 1 || years > 60) throw new BadRequestException('Years must be a whole number from 1 to 60');
  return { start, monthly, rate, years };
}

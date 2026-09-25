import { BadRequestException } from '@nestjs/common';
import { parseGrowthQuery } from './growth-query';

const ok = { start: '0', monthly: '1000', rate: '10', years: '15' };

describe('parseGrowthQuery', () => {
  it('reads the four numbers', () => {
    expect(parseGrowthQuery(ok)).toEqual({ start: 0, monthly: 1000, rate: 10, years: 15 });
  });

  it.each([
    ['start is missing', { ...ok, start: undefined }],
    ['start is not a number', { ...ok, start: 'abc' }],
    ['start is negative', { ...ok, start: '-1' }],
    ['monthly is over 1e12', { ...ok, monthly: '2e12' }],
    ['both amounts are 0', { ...ok, start: '0', monthly: '0' }],
    ['the rate is over 100', { ...ok, rate: '101' }],
    ['the rate is negative', { ...ok, rate: '-1' }],
    ['years is 0', { ...ok, years: '0' }],
    ['years is 61', { ...ok, years: '61' }],
    ['years is not whole', { ...ok, years: '2.5' }],
    ['years is not a number', { ...ok, years: 'x' }],
    ['monthly is negative', { ...ok, monthly: '-1' }],
    ['start is over 1e12', { ...ok, start: '2e12' }],
    ['start is empty', { ...ok, start: '' }],
    ['start is an array', { ...ok, start: ['1'] }],
  ])('refuses when %s', (_label, query) => {
    expect(() => parseGrowthQuery(query as Record<string, unknown>)).toThrow(BadRequestException);
  });

  it.each([
    ['a 0% rate', { ...ok, rate: '0' }],
    ['a 100% rate', { ...ok, rate: '100' }],
    ['1 year', { ...ok, years: '1' }],
    ['60 years', { ...ok, years: '60' }],
    ['a 1e12 starting amount', { ...ok, start: '1e12' }],
    ['a 1e12 monthly deposit', { ...ok, monthly: '1e12' }],
  ])('accepts %s', (_label, query) => {
    expect(() => parseGrowthQuery(query as Record<string, unknown>)).not.toThrow();
  });
});

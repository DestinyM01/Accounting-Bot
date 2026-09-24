import { budgetResult, budgetStatus, renderMonthly, renderWeekly } from './report-render';
import { Health, MonthlyReportData, WeeklyReportData } from './report-types';

const at = (iso: string) => new Date(iso);
const opts = { webUrl: 'https://dashboard.example.com' };

const health = (overrides: Partial<Health> = {}): Health => ({
  overdueRecurring: [],
  lastIngestedAt: at('2026-09-27T14:00:00Z'),
  daysSinceIngest: 0,
  ingestionStale: false,
  ...overrides,
});

function weekly(overrides: Partial<WeeklyReportData> = {}): WeeklyReportData {
  return {
    from: at('2026-09-21T04:00:00Z'),
    to: at('2026-09-28T04:00:00Z'),
    week: {
      spent: 18450,
      income: 45000,
      topCategories: [
        { category: 'housing', total: 12000 },
        { category: 'food', total: 6450 },
      ],
      largest: [{ name: 'Rent Co', at: at('2026-09-22T15:00:00Z'), amount: 12000 }],
    },
    month: {
      label: 'September',
      spent: 61200,
      income: 75000,
      net: 13800,
      budgets: [{ category: 'food', limit: 10000, spent: 8000 }],
    },
    waiting: { unresolved: 0, toReview: 0 },
    health: health(),
    ...overrides,
  };
}

function monthly(overrides: Partial<MonthlyReportData> = {}): MonthlyReportData {
  return {
    month: 9,
    year: 2026,
    income: 75000,
    expense: 61200,
    net: 13800,
    previousExpense: 0,
    categories: [{ category: 'housing', total: 36000 }],
    budgets: [],
    ...overrides,
  };
}

describe('renderWeekly', () => {
  it('names the week and what was spent in the subject', () => {
    expect(renderWeekly(weekly(), opts).subject).toBe('Weekly digest · Sep 21–27 · RD$ 18,450 spent');
  });

  it('is a complete HTML document with its charset', () => {
    expect(renderWeekly(weekly(), opts).html.startsWith('<!doctype html><html><head><meta charset="utf-8">')).toBe(true);
  });

  it('escapes the dashboard address in links', () => {
    const html = renderWeekly(weekly(), { webUrl: 'https://x.example.com/?a=1&b="2"' }).html;
    expect(html).toContain('href="https://x.example.com/?a=1&amp;b=&quot;2&quot;"');
    expect(html).not.toContain('b="2"');
  });

  it('writes a week across two months in full, and marks a test', () => {
    const email = renderWeekly(weekly({ from: at('2026-09-28T04:00:00Z'), to: at('2026-10-05T04:00:00Z') }), {
      ...opts,
      test: true,
    });
    expect(email.subject).toBe('[Test] Weekly digest · Sep 28 – Oct 4 · RD$ 18,450 spent');
  });

  it('shows what is waiting only when something is', () => {
    expect(renderWeekly(weekly(), opts).text).not.toContain('WAITING FOR YOU');
    const text = renderWeekly(weekly({ waiting: { unresolved: 2, toReview: 1 } }), opts).text;
    expect(text).toContain('WAITING FOR YOU');
    expect(text).toContain('2 transfers waiting for Internal/Expense');
    expect(text).toContain('1 category to review');
  });

  it('says all is well, with the last ingested day, when nothing is wrong', () => {
    expect(renderWeekly(weekly(), opts).text).toContain(
      'Recurring payments and bank emails are up to date. Last bank email ingested Sep 27.',
    );
  });

  it('names each health problem instead', () => {
    const text = renderWeekly(
      weekly({
        health: health({
          overdueRecurring: [{ name: 'gym', dueAt: at('2026-09-20T12:00:00Z') }],
          lastIngestedAt: at('2026-09-19T14:00:00Z'),
          daysSinceIngest: 5,
          ingestionStale: true,
        }),
      }),
      opts,
    ).text;
    expect(text).toContain('Recurring "gym" was due Sep 20 and hasn\'t been booked.');
    expect(text).toContain('No bank email ingested since Sep 19 (5 days).');
    expect(text).not.toContain('up to date');
  });

  it('says so when no bank email was ever ingested', () => {
    const text = renderWeekly(
      weekly({ health: health({ lastIngestedAt: null, daysSinceIngest: null, ingestionStale: true }) }),
      opts,
    ).text;
    expect(text).toContain('No bank email has been ingested yet.');
  });

  it('keeps the last ingested day beside other health problems', () => {
    const text = renderWeekly(
      weekly({ health: health({ overdueRecurring: [{ name: 'gym', dueAt: at('2026-09-20T12:00:00Z') }] }) }),
      opts,
    ).text;
    expect(text).toContain('Recurring "gym" was due Sep 20 and hasn\'t been booked.');
    expect(text).toContain('Last bank email ingested Sep 27.');
    expect(text).not.toContain('up to date');
  });

  it('dates by the Santo Domingo day, not the UTC day', () => {
    const text = renderWeekly(
      weekly({ week: { ...weekly().week, largest: [{ name: 'Late Colmado', at: at('2026-09-22T02:30:00Z'), amount: 300 }] } }),
      opts,
    ).text;
    expect(text).toContain('Late Colmado · Sep 21');
  });

  it('escapes bank and user text in the HTML and keeps it verbatim in the text', () => {
    const email = renderWeekly(
      weekly({
        week: { ...weekly().week, largest: [{ name: '<script>alert(1)</script>', at: at('2026-09-22T15:00:00Z'), amount: 50 }] },
        health: health({ overdueRecurring: [{ name: 'A & B "quoted"', dueAt: at('2026-09-20T12:00:00Z') }] }),
      }),
      opts,
    );
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('A &amp; B &quot;quoted&quot;');
    expect(email.text).toContain('<script>alert(1)</script>');
    expect(email.text).toContain('Recurring "A & B "quoted"" was due Sep 20');
  });
});

describe('renderMonthly', () => {
  it('names the month, spending and signed net in whole pesos', () => {
    expect(renderMonthly(monthly(), opts).subject).toBe('September 2026 · RD$ 61,200 spent · net +RD$ 13,800');
    expect(renderMonthly(monthly({ expense: 61200.6, net: -2100.4 }), opts).subject).toBe(
      'September 2026 · RD$ 61,201 spent · net −RD$ 2,100',
    );
  });

  it('compares spending with the month before only when there was some', () => {
    expect(renderMonthly(monthly(), opts).text).not.toContain('vs the month before');
    expect(renderMonthly(monthly({ previousExpense: 54642.9 }), opts).text).toContain('(+12% vs the month before)');
    expect(renderMonthly(monthly({ previousExpense: 66521.7 }), opts).text).toContain('(−8% vs the month before)');
  });

  it('lists budgets only when the month had some', () => {
    expect(renderMonthly(monthly(), opts).text).not.toContain('BUDGETS');
    const text = renderMonthly(monthly({ budgets: [{ category: 'food', limit: 10000, spent: 11500 }] }), opts).text;
    expect(text).toContain('BUDGETS');
    expect(text).toContain('food: RD$ 11,500 of RD$ 10,000 · over by RD$ 1,500');
  });
});

describe('budgetResult', () => {
  it('reads over by, on budget, or under by, in whole pesos', () => {
    expect(budgetResult({ category: 'food', limit: 10000, spent: 11500 })).toBe('over by RD$ 1,500');
    expect(budgetResult({ category: 'food', limit: 10000, spent: 10000.2 })).toBe('on budget');
    expect(budgetResult({ category: 'food', limit: 10000, spent: 7250 })).toBe('under by RD$ 2,750');
  });
});

describe('budgetStatus', () => {
  it('reads on track below 80%, ≥ 80% up to the limit, and over only past it', () => {
    expect(budgetStatus({ category: 'food', limit: 10000, spent: 7999 })).toBe('on track');
    expect(budgetStatus({ category: 'food', limit: 10000, spent: 8000 })).toBe('≥ 80%');
    expect(budgetStatus({ category: 'food', limit: 10000, spent: 10000 })).toBe('≥ 80%');
    expect(budgetStatus({ category: 'food', limit: 10000, spent: 10001 })).toBe('over by RD$ 1');
    expect(budgetStatus({ category: 'fun', limit: 0, spent: 0 })).toBe('on track');
  });
});

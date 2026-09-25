# Growth Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/calculator` page that shows how savings grow with compound interest, year by year, with a one-click "Use my numbers".

**Architecture:**
- **The math.** A pure `compoundGrowth()` in the api, computed month by month and covered by Jest, is served by `GET /calculator/compound`.
- **"My numbers".** `GET /calculator/my-numbers` returns the current balance and the average monthly savings of the last 3 complete months, via `StatisticsService`.
- **The page.** It calls both, debounced, and draws figures, a stacked Chart.js bar chart and a year table.

**Tech Stack:**
- api: NestJS 10, Mongoose 8, Jest, pnpm.
- web: Angular 17 standalone, Chart.js, pnpm. It has no test runner, so it is verified by a clean build and no colour literals.

**Spec:** `docs/superpowers/specs/2026-09-25-growth-calculator-design.md`.

---

## Ground rules for every task

- **Paths.** Repo root: `C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot`. Use Git Bash, and `cd` with an absolute path in every command.
- **Branch.** Work on `main`; the user works trunk-based. **Never push, amend, rebase or reset.** Stage with `git add <explicit paths>` only.
- **Commits.** Every message ends with a blank line and exactly one trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Public repo.** Generic test data only.
- **Baseline.** Before Task 1, the api has **54 suites / 577 tests**, all passing. Each task states the expected counts. If yours differ, report the exact numbers and why.
- **Web.** Theme tokens (`var(--…)`) only in stylesheets; check that every token you use exists in `web/src/tokens.css`. The form classes `fc-field`, `fc-input`, `fc-btn`, `fc-btn--primary`, `fc-btn--ghost` and `fc-error`, and `.card` and `.page-wrap`, are global.

## File map

| File | Status | Responsibility |
|---|---|---|
| `api/src/calculator/compound-growth.ts` (+ spec) | create | the pure month-by-month computation |
| `api/src/calculator/growth-query.ts` (+ spec) | create | query validation, a 400 per rule |
| `api/src/calculator/calculator.service.ts` (+ spec) | create | `compound()` and `myNumbers()` |
| `api/src/calculator/calculator.controller.ts`, `calculator.module.ts` | create | the routes and wiring |
| `api/src/app.module.ts`, `api/src/transactions/transactions.controller.spec.ts` | modify | wiring; guard table |
| `web/src/app/core/services/api.models.ts`, `api.service.ts` | modify | types and calls |
| `web/src/app/pages/calculator/calculator.component.{ts,html,scss}` | create | the page |
| `web/src/app/app.routes.ts`, `app.component.ts` | modify | route and nav |
| `README.md` | modify | the feature row and endpoints |

---

### Task 1: The pure computation

**Files:**
- Create: `api/src/calculator/compound-growth.ts`
- Test: `api/src/calculator/compound-growth.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { compoundGrowth } from './compound-growth';

describe('compoundGrowth', () => {
  it('earns nothing at 0%: the balance is what was put in', () => {
    expect(compoundGrowth({ start: 500, monthly: 100, rate: 0, years: 2 })).toEqual({
      finalBalance: 2900,
      putIn: 2900,
      interest: 0,
      years: [
        { year: 1, balance: 1700, putIn: 1700, interest: 0 },
        { year: 2, balance: 2900, putIn: 2900, interest: 0 },
      ],
    });
  });

  it('compounds a starting amount monthly: $1,000 at 12% for a year', () => {
    expect(compoundGrowth({ start: 1000, monthly: 0, rate: 12, years: 1 })).toMatchObject({
      finalBalance: 1126.83,
      putIn: 1000,
      interest: 126.83,
    });
  });

  it('adds each deposit at the end of its month: $100/month at 12% for a year', () => {
    expect(compoundGrowth({ start: 0, monthly: 100, rate: 12, years: 1 })).toMatchObject({
      finalBalance: 1268.25,
      putIn: 1200,
      interest: 68.25,
    });
  });

  it("matches the closed-form annuity for the bot's example: $1,000/month for 15 years at 10%", () => {
    const i = 0.1 / 12;
    const n = 15 * 12;
    const closedForm = Math.round(1000 * ((Math.pow(1 + i, n) - 1) / i) * 100) / 100;
    const r = compoundGrowth({ start: 0, monthly: 1000, rate: 10, years: 15 });
    expect(Math.abs(r.finalBalance - closedForm)).toBeLessThanOrEqual(0.01);
    expect(r.putIn).toBe(180000);
    expect(r.years).toHaveLength(15);
  });

  it('gives one row per year with the exact amount put in so far, the last being the final figures', () => {
    const r = compoundGrowth({ start: 250, monthly: 50, rate: 5, years: 3 });
    expect(r.years.map((y) => [y.year, y.putIn])).toEqual([[1, 850], [2, 1450], [3, 2050]]);
    expect(r.finalBalance).toBe(r.years[2].balance);
    expect(r.interest).toBe(r.years[2].interest);
  });

  it('rounds only on output, never the running balance', () => {
    // 0.333 × 12 = 3.996 → $4.00; rounding each month would give 0.33 × 12 = $3.96.
    expect(compoundGrowth({ start: 0, monthly: 0.333, rate: 0, years: 1 }).finalBalance).toBe(4);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- compound-growth 2>&1 | tail -6
```
Expected: FAIL. The module `./compound-growth` isn't found.

- [ ] **Step 3: Implement**

```ts
export interface GrowthInput {
  start: number;
  monthly: number;
  /** Percent per year. */
  rate: number;
  years: number;
}

export interface GrowthYear {
  year: number;
  balance: number;
  putIn: number;
  interest: number;
}

export interface GrowthResult {
  finalBalance: number;
  putIn: number;
  interest: number;
  years: GrowthYear[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Savings growth with compound interest, month by month. The balance earns
 * rate/12 each month, and each monthly deposit is added at the end of its
 * month (an ordinary annuity), so it starts earning the month after. Rounding
 * happens only on output; the running balance keeps full precision.
 */
export function compoundGrowth({ start, monthly, rate, years }: GrowthInput): GrowthResult {
  const monthlyRate = rate / 100 / 12;
  let balance = start;
  const rows: GrowthYear[] = [];
  for (let year = 1; year <= years; year++) {
    for (let m = 0; m < 12; m++) balance = balance * (1 + monthlyRate) + monthly;
    const putIn = start + monthly * 12 * year;
    rows.push({ year, balance: round2(balance), putIn: round2(putIn), interest: round2(balance - putIn) });
  }
  const last = rows[rows.length - 1];
  return { finalBalance: last.balance, putIn: last.putIn, interest: last.interest, years: rows };
}
```

- [ ] **Step 4: Run the suite**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5
```
Expected: **55 suites / 583 tests**, all passing.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/calculator/compound-growth.ts api/src/calculator/compound-growth.spec.ts
git commit -F- <<'EOF'
feat(api): compound growth, month by month, rounded only on output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Validation and "my numbers"

**Files:**
- Create: `api/src/calculator/growth-query.ts`, `api/src/calculator/calculator.service.ts`
- Test: `api/src/calculator/growth-query.spec.ts`, `api/src/calculator/calculator.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

`growth-query.spec.ts`:
```ts
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
  ])('refuses when %s', (_label, query) => {
    expect(() => parseGrowthQuery(query as Record<string, unknown>)).toThrow(BadRequestException);
  });
});
```

`calculator.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { CalculatorService } from './calculator.service';
import { Balance } from '../shared/schemas/balance.schema';
import { StatisticsService } from '../statistics/statistics.service';

function query(result: unknown) {
  const q: any = { select: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const summary = (month: number, year: number, income: number, expense: number) => ({
  month, year, income, expense, net: Math.round((income - expense) * 100) / 100, transactionCount: 1,
});

describe('CalculatorService', () => {
  let service: CalculatorService;
  let balanceModel: { findOne: jest.Mock };
  let statistics: { summary: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    balanceModel = { findOne: jest.fn(() => query({ balance: 1234.567 })) };
    statistics = { summary: jest.fn(async (m: number, y: number) => summary(m, y, 1000 * m, 500 * m)) };
    const mod = await Test.createTestingModule({
      providers: [
        CalculatorService,
        { provide: getModelToken(Balance.name), useValue: balanceModel },
        { provide: StatisticsService, useValue: statistics },
      ],
    }).compile();
    service = mod.get(CalculatorService);
  });

  it('computes a valid query and refuses an invalid one', () => {
    expect(service.compound({ start: '1000', monthly: '0', rate: '12', years: '1' }).finalBalance).toBe(1126.83);
    expect(() => service.compound({ start: '0', monthly: '0', rate: '12', years: '1' })).toThrow(BadRequestException);
  });

  describe('myNumbers', () => {
    it('averages the 3 complete months before this one, across a year boundary, oldest first', async () => {
      const r = await service.myNumbers(new Date(2026, 0, 15));
      expect(statistics.summary.mock.calls).toEqual([[10, 2025], [11, 2025], [12, 2025]]);
      expect(r.months.map((m) => [m.month, m.year])).toEqual([[10, 2025], [11, 2025], [12, 2025]]);
      expect(r.monthlySavings).toBe(5500); // nets 5000, 5500, 6000
      expect(r.spentMore).toBe(false);
      expect(r.startingAmount).toBe(1234.57);
      expect(balanceModel.findOne).toHaveBeenCalledWith({ userId: 1 });
    });

    it('rounds the average to cents', async () => {
      statistics.summary
        .mockResolvedValueOnce(summary(7, 2026, 100, 0))
        .mockResolvedValueOnce(summary(8, 2026, 100, 0))
        .mockResolvedValueOnce(summary(9, 2026, 100.01, 0));
      expect((await service.myNumbers(new Date(2026, 9, 1))).monthlySavings).toBe(100);
    });

    it('offers 0 when more was spent than earned, and says so', async () => {
      statistics.summary.mockImplementation(async (m: number, y: number) => summary(m, y, 100, 300));
      const r = await service.myNumbers(new Date(2026, 9, 1));
      expect(r.monthlySavings).toBe(0);
      expect(r.spentMore).toBe(true);
    });

    it('starts from 0 for a negative balance or none', async () => {
      balanceModel.findOne.mockReturnValueOnce(query({ balance: -50 }));
      expect((await service.myNumbers(new Date(2026, 9, 1))).startingAmount).toBe(0);
      balanceModel.findOne.mockReturnValueOnce(query(null));
      expect((await service.myNumbers(new Date(2026, 9, 1))).startingAmount).toBe(0);
    });

    it('does not claim overspending when there was no activity at all', async () => {
      statistics.summary.mockImplementation(async (m: number, y: number) => summary(m, y, 0, 0));
      const r = await service.myNumbers(new Date(2026, 9, 1));
      expect(r.monthlySavings).toBe(0);
      expect(r.spentMore).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- calculator growth-query 2>&1 | tail -8
```
Expected: FAIL. `./growth-query` and `./calculator.service` aren't found.

- [ ] **Step 3: Implement**

`growth-query.ts`:
```ts
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
```
`calculator.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../shared/schemas/balance.schema';
import { StatisticsService } from '../statistics/statistics.service';
import { compoundGrowth, GrowthResult } from './compound-growth';
import { parseGrowthQuery } from './growth-query';

export interface MyNumbers {
  startingAmount: number;
  monthlySavings: number;
  /** The average was ≤ 0 while there was some activity: the page says so instead of silently offering 0. */
  spentMore: boolean;
  months: { month: number; year: number; income: number; expense: number; net: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class CalculatorService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
    private readonly statistics: StatisticsService,
  ) {}

  compound(query: Record<string, unknown>): GrowthResult {
    return compoundGrowth(parseGrowthQuery(query));
  }

  /**
   * The user's own starting point: today's balance, and the average saved per
   * month over the 3 complete calendar months before this one, counted the way
   * Statistics counts (server-local months; transfers between own accounts excluded).
   */
  async myNumbers(now: Date = new Date()): Promise<MyNumbers> {
    const months = [3, 2, 1].map((back) => {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    });
    const [balanceDoc, summaries] = await Promise.all([
      this.balanceModel.findOne({ userId: this.userId }).select('balance').lean(),
      Promise.all(months.map((m) => this.statistics.summary(m.month, m.year))),
    ]);
    const rows = summaries.map((s) => ({ month: s.month, year: s.year, income: s.income, expense: s.expense, net: s.net }));
    const average = rows.reduce((sum, r) => sum + r.net, 0) / rows.length;
    const anyActivity = rows.some((r) => r.income > 0 || r.expense > 0);
    return {
      startingAmount: round2(Math.max(0, balanceDoc?.balance ?? 0)),
      monthlySavings: round2(Math.max(0, average)),
      spentMore: anyActivity && average <= 0,
      months: rows,
    };
  }
}
```

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **57 suites / 601 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/calculator/growth-query.ts api/src/calculator/growth-query.spec.ts api/src/calculator/calculator.service.ts api/src/calculator/calculator.service.spec.ts
git commit -F- <<'EOF'
feat(api): validate the calculator's inputs and offer the user's own numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Routes and wiring

**Files:**
- Create: `api/src/calculator/calculator.controller.ts`, `api/src/calculator/calculator.module.ts`
- Modify: `api/src/app.module.ts`
- Test: `api/src/transactions/transactions.controller.spec.ts` (the guard table)

- [ ] **Step 1: Write the failing test**

In `transactions.controller.spec.ts`, add `import { CalculatorController } from '../calculator/calculator.controller';` and the row `['CalculatorController', CalculatorController],`.

- [ ] **Step 2: Run it and see it fail**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test -- transactions.controller 2>&1 | tail -6
```
Expected: FAIL. `../calculator/calculator.controller` isn't found.

- [ ] **Step 3: Implement**

`calculator.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CalculatorService } from './calculator.service';

@Controller('calculator')
@UseGuards(JwtAuthGuard)
export class CalculatorController {
  constructor(private readonly calculator: CalculatorService) {}

  @Get('compound')
  compound(@Query() query: Record<string, unknown>) {
    return this.calculator.compound(query);
  }

  @Get('my-numbers')
  myNumbers() {
    return this.calculator.myNumbers();
  }
}
```
`calculator.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
import { StatisticsModule } from '../statistics/statistics.module';
import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Balance.name, schema: BalanceSchema }]), StatisticsModule],
  controllers: [CalculatorController],
  providers: [CalculatorService],
})
export class CalculatorModule {}
```
`app.module.ts`: add `import { CalculatorModule } from './calculator/calculator.module';` and `CalculatorModule,` at the end of `imports`.

If the guard-table spec now fails to load because `StatisticsModule` reaches something ESM-only, it already has the `@nestjs/schedule` shim; add any other shim the same way and report it.

- [ ] **Step 4: Run the suite and the build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
```
Expected: **57 suites / 602 tests**, all passing; the build is clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add api/src/calculator/calculator.controller.ts api/src/calculator/calculator.module.ts api/src/app.module.ts api/src/transactions/transactions.controller.spec.ts
git commit -F- <<'EOF'
feat(api): GET /calculator/compound and /calculator/my-numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Web models and calls

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`, `web/src/app/core/services/api.service.ts`

- [ ] **Step 1: Models**

Append to `api.models.ts`:
```ts
// ── Growth calculator ──────────────────────────────────────────────────
export interface GrowthInput {
  start: number;
  monthly: number;
  rate: number;
  years: number;
}

export interface GrowthYear {
  year: number;
  balance: number;
  putIn: number;
  interest: number;
}

export interface GrowthResult {
  finalBalance: number;
  putIn: number;
  interest: number;
  years: GrowthYear[];
}

export interface MyNumbers {
  startingAmount: number;
  monthlySavings: number;
  spentMore: boolean;
  months: { month: number; year: number; income: number; expense: number; net: number }[];
}
```

- [ ] **Step 2: Calls**

In `api.service.ts`, add `GrowthInput`, `GrowthResult` and `MyNumbers` to the `api.models` import, and:
```ts
  compoundGrowth(input: GrowthInput): Observable<GrowthResult> {
    const params = new HttpParams()
      .set('start', input.start)
      .set('monthly', input.monthly)
      .set('rate', input.rate)
      .set('years', input.years);
    return this.http.get<GrowthResult>(`${this.base}/calculator/compound`, { params });
  }

  getMyNumbers(): Observable<MyNumbers> {
    return this.http.get<MyNumbers>(`${this.base}/calculator/my-numbers`);
  }
```

- [ ] **Step 3: Build**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: `web-done` alone.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/core/services/api.models.ts web/src/app/core/services/api.service.ts
git commit -F- <<'EOF'
feat(web): API calls for the growth calculator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The page, its route and the nav

**Files:**
- Create: `web/src/app/pages/calculator/calculator.component.ts`, `.html` and `.scss`
- Modify: `web/src/app/app.routes.ts`, `web/src/app/app.component.ts`

- [ ] **Step 1: The component**

`calculator.component.ts`:
```ts
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { GrowthInput, GrowthResult, MyNumbers } from '../../core/services/api.models';

Chart.register(...registerables);

/** How savings grow with compound interest; the math runs (and is tested) in the api. */
@Component({
  selector: 'app-calculator',
  standalone: true,
  imports: [CurrencyPipe, FormsModule, MatIconModule],
  templateUrl: './calculator.component.html',
  styleUrls: ['./calculator.component.scss'],
})
export class CalculatorComponent implements OnInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;

  // The bot's own example, read the way its help text meant it.
  start: number | null = 0;
  monthly: number | null = 1000;
  rate: number | null = 10;
  years: number | null = 15;

  result: GrowthResult | null = null;
  /** The inputs no longer match the result on screen (they're invalid, or the last request failed). */
  stale = false;
  inputError = '';
  loading = false;
  showTable = false;

  mine: MyNumbers | null = null;
  mineLoading = false;
  mineError = '';

  private gen = 0;
  private destroyed = false;
  private chart: Chart | null = null;
  private readonly changes$ = new Subject<void>();
  private readonly subs = new Subscription();

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.subs.add(this.changes$.pipe(debounceTime(300)).subscribe(() => this.calculate()));
    this.calculate();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
    this.chart?.destroy();
  }

  onChange() {
    this.changes$.next();
  }

  /** "Jul–Sep", for the note under "Use my numbers". */
  get mineSpan(): string {
    const months = this.mine?.months ?? [];
    if (months.length === 0) return '';
    const name = (m: { month: number; year: number }) => new Date(m.year, m.month - 1, 1).toLocaleString('en', { month: 'short' });
    return `${name(months[0])}–${name(months[months.length - 1])}`;
  }

  /** The chart's text alternative. */
  get chartSummary(): string {
    const r = this.result;
    if (!r) return '';
    const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    return `After ${r.years.length} years: ${money(r.finalBalance)} — ${money(r.putIn)} put in, ${money(r.interest)} interest`;
  }

  useMyNumbers() {
    if (this.mineLoading) return;
    this.mineLoading = true;
    this.mineError = '';
    this.subs.add(
      this.api.getMyNumbers().subscribe({
        next: (n) => {
          this.mineLoading = false;
          this.mine = n;
          this.start = n.startingAmount;
          this.monthly = n.monthlySavings;
          this.calculate();
        },
        error: (e: HttpErrorResponse) => {
          this.mineLoading = false;
          this.mineError = this.message(e, "Couldn't load your numbers.");
        },
      }),
    );
  }

  private calculate() {
    const input = this.readInput();
    if (typeof input === 'string') {
      this.inputError = input;
      this.stale = !!this.result;
      return;
    }
    const gen = ++this.gen;
    this.loading = true;
    this.subs.add(
      this.api.compoundGrowth(input).subscribe({
        next: (r) => {
          if (gen !== this.gen) return; // a newer calculation owns the page
          this.loading = false;
          this.result = r;
          this.stale = false;
          this.inputError = '';
          setTimeout(() => this.draw(), 0); // the canvas renders with the first result
        },
        error: (e: HttpErrorResponse) => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.inputError = this.message(e, "Couldn't calculate. Please try again.");
          this.stale = !!this.result;
        },
      }),
    );
  }

  /** The fields as the api expects them, or why they can't be sent yet. The api checks the ranges. */
  private readInput(): GrowthInput | string {
    const values = [this.start, this.monthly, this.rate, this.years];
    if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'Fill in all four fields.';
    return { start: this.start!, monthly: this.monthly!, rate: this.rate!, years: this.years! };
  }

  private draw() {
    const canvas = this.chartCanvas?.nativeElement;
    const r = this.result;
    if (this.destroyed || !canvas || !r) return;
    // Theme colours, read at runtime so the chart follows the design tokens.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const first = !this.chart;
    this.chart?.destroy();
    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: r.years.map((y) => `Year ${y.year}`),
        datasets: [
          { label: 'Put in', data: r.years.map((y) => y.putIn), backgroundColor: token('--text-muted'), stack: 'total' },
          { label: 'Interest', data: r.years.map((y) => y.interest), backgroundColor: token('--accent'), stack: 'total' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: first ? undefined : false,
        plugins: { legend: { labels: { color: token('--text-muted') } } },
        scales: {
          x: { stacked: true, grid: { color: token('--border') }, ticks: { color: token('--text-muted'), maxTicksLimit: 10 } },
          y: { stacked: true, grid: { color: token('--border') }, ticks: { color: token('--text-muted') } },
        },
      },
    });
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }
}
```

`calculator.component.html`:
```html
<div class="page-wrap">
  <div class="calc-header">
    <h1>Growth calculator</h1>
    <p>How savings grow with compound interest.</p>
  </div>

  <div class="calc-layout">
    <section class="card calc-panel" aria-labelledby="calc-inputs-title">
      <h2 id="calc-inputs-title">Your plan</h2>
      <label class="fc-field">
        <span>Starting amount ($)</span>
        <input class="fc-input" type="number" min="0" step="0.01" [(ngModel)]="start" (ngModelChange)="onChange()" name="start" />
      </label>
      <label class="fc-field">
        <span>Monthly deposit ($)</span>
        <input class="fc-input" type="number" min="0" step="0.01" [(ngModel)]="monthly" (ngModelChange)="onChange()" name="monthly" />
      </label>
      <label class="fc-field">
        <span>Annual rate (%)</span>
        <input class="fc-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="rate" (ngModelChange)="onChange()" name="rate" />
      </label>
      <label class="fc-field">
        <span>Years</span>
        <input class="fc-input" type="number" min="1" max="60" step="1" [(ngModel)]="years" (ngModelChange)="onChange()" name="years" />
      </label>

      <button type="button" class="fc-btn fc-btn--ghost" [disabled]="mineLoading" (click)="useMyNumbers()">
        <mat-icon>person</mat-icon>
        {{ mineLoading ? 'Loading…' : 'Use my numbers' }}
      </button>
      <p class="calc-note" aria-live="polite">
        @if (mine) {
          Your balance today · average saved over {{ mineSpan }}: {{ mine.monthlySavings | currency: 'USD' : 'symbol' : '1.2-2' }}
          @if (mine.spentMore) {
            — you spent more than you earned, so {{ 0 | currency: 'USD' : 'symbol' : '1.2-2' }}
          }
        }
      </p>
      @if (mineError) {
        <p class="fc-error" role="alert">{{ mineError }}</p>
      }
      @if (inputError) {
        <p class="fc-error" role="alert">{{ inputError }}</p>
      }
    </section>

    <section class="card calc-panel" aria-labelledby="calc-results-title">
      <h2 id="calc-results-title">What it grows to</h2>
      @if (result) {
        @if (stale) {
          <p class="calc-note">Showing the last valid result</p>
        }
        <div class="calc-figures" aria-live="polite">
          <div class="calc-figure">
            <span>Final balance</span>
            <strong>{{ result.finalBalance | currency: 'USD' : 'symbol' : '1.2-2' }}</strong>
          </div>
          <div class="calc-figure">
            <span>You put in</span>
            <strong>{{ result.putIn | currency: 'USD' : 'symbol' : '1.2-2' }}</strong>
          </div>
          <div class="calc-figure">
            <span>Interest earned</span>
            <strong class="calc-interest">{{ result.interest | currency: 'USD' : 'symbol' : '1.2-2' }}</strong>
          </div>
        </div>

        <div class="calc-chart">
          <canvas #chartCanvas role="img" [attr.aria-label]="chartSummary"></canvas>
        </div>

        <button
          type="button"
          class="fc-btn fc-btn--ghost"
          [attr.aria-expanded]="showTable"
          [attr.aria-controls]="showTable ? 'calc-table' : null"
          (click)="showTable = !showTable"
        >
          {{ showTable ? 'Hide the table' : 'Show the table' }}
        </button>
        @if (showTable) {
          <div id="calc-table" class="calc-table-wrap">
            <table class="calc-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Put in</th>
                  <th scope="col">Interest</th>
                  <th scope="col">Balance</th>
                </tr>
              </thead>
              <tbody>
                @for (y of result.years; track y.year) {
                  <tr>
                    <td>{{ y.year }}</td>
                    <td>{{ y.putIn | currency: 'USD' : 'symbol' : '1.2-2' }}</td>
                    <td>{{ y.interest | currency: 'USD' : 'symbol' : '1.2-2' }}</td>
                    <td>{{ y.balance | currency: 'USD' : 'symbol' : '1.2-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else if (loading) {
        <p class="calc-note">Calculating…</p>
      }

      <div class="calc-explainer">
        <h3>How it works</h3>
        <p>Each month your balance earns a twelfth of the yearly rate, and that interest earns interest from then on.</p>
        <p>Deposits are added at the end of each month, so each one starts earning the month after.</p>
        <p>The longer the money stays, the more of the final balance is interest rather than deposits.</p>
      </div>
    </section>
  </div>
</div>
```

`calculator.component.scss`, theme tokens only:
```scss
.calc-header {
  margin-bottom: var(--space-md);
  h1 { margin: 0; }
  p { margin: 4px 0 0; font-size: 0.9rem; color: var(--text-muted); }
}

.calc-layout {
  display: grid;
  grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
  gap: var(--space-md);
  align-items: start;

  @media (max-width: 900px) { grid-template-columns: minmax(0, 1fr); }
}

.calc-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
}

h2 { margin: 0; font-size: 1.1rem; color: var(--text); }
h3 { margin: 0; font-size: 0.95rem; color: var(--text); }

.calc-note { margin: 0; font-size: 0.85rem; color: var(--text-muted); }

.calc-figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-xs);

  @media (max-width: 480px) { grid-template-columns: minmax(0, 1fr); }
}

.calc-figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  span { font-size: 0.8rem; color: var(--text-muted); }
  strong { font-size: 1.2rem; color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  strong.calc-interest { color: var(--accent); }
}

.calc-chart { position: relative; height: 260px; }

.calc-table-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.calc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;

  th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--border); color: var(--text); }
  th { position: sticky; top: 0; background: var(--bg-card); color: var(--text-muted); font-weight: 600; }
  th:first-child, td:first-child { text-align: left; }
}

.calc-explainer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--space-sm);
  p { margin: 0; font-size: 0.85rem; color: var(--text-muted); }
}
```
If `--radius-sm` or `--bg-card` is missing from `web/src/tokens.css`, use the nearest existing token and report it.

- [ ] **Step 2: Route and nav**

`app.routes.ts`: directly after the `tips` route, add a lazy route in the same shape as its neighbours:
```ts
  {
    path: 'calculator',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/calculator/calculator.component').then((m) => m.CalculatorComponent),
  },
```
`app.component.ts`: between the Tips and Settings nav entries, add `{ label: 'Growth calculator', icon: 'savings', path: '/calculator' },`, aligned like its neighbours.

- [ ] **Step 3: Build and check**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" src/app/pages/calculator/calculator.component.scss; echo literal-done
```
Expected: `web-done` alone and `literal-done` alone.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add web/src/app/pages/calculator/calculator.component.ts web/src/app/pages/calculator/calculator.component.html web/src/app/pages/calculator/calculator.component.scss web/src/app/app.routes.ts web/src/app/app.component.ts
git commit -F- <<'EOF'
feat(web): the growth calculator — compound interest with your own numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

- After the **Settings** feature row, add:
```markdown
| **Growth calculator** | Compound interest from a starting amount and a monthly deposit, year by year, with a chart and a table; one click fills in your balance and average monthly savings |
```
- In the API table, after the `/api/ingestion/...` rows, add:
```markdown
| `GET` | `/api/calculator/compound?start=&monthly=&rate=&years=` | Month-by-month compound growth, with one row per year |
| `GET` | `/api/calculator/my-numbers` | Today's balance and the average saved per month over the last 3 complete months |
```

- [ ] **Step 2: Suites and builds**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/api" && pnpm test 2>&1 | tail -5 && pnpm run build 2>&1 | tail -3
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot/web" && pnpm run build 2>&1 | grep -iE "warning|error"; echo web-done
```
Expected: api **57 suites / 602 tests**, build clean; web `web-done` alone.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/ManMC/OneDrive/Documentos/Code-Projects/ClaudeCode_sessions/Acc_bot" && git add README.md
git commit -F- <<'EOF'
docs(readme): the growth calculator and its endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --format=%B -6 | grep -c "Co-Authored-By: Claude Opus 5.5"
git status --short
```
Expected: `6`, and a clean tree.

---

## After the tasks (controller)

1. Review: one combined spec-and-quality pass, since the feature is small. Then fixes, a preview-harness screenshot (desktop and phone), the private-identifier gate, and the push. The push carries the fixture fix `2fb0e0b` too.
2. Hand the user: restart `accounting-api` and `accounting-web` once CI is green; open **Growth calculator**, press **Use my numbers**, and change the rate.

## As built (2026-09-25)

Tasks 1–6 landed as written in `0d365c2`, `2e0884d`, `a1841e3`, `3bac482`, `6a4b747` and `68a4ba5`, with no deviations. The counts matched the plan at every step (577 → 602).

**Preview:** a scratch harness rendered the real page against a fake api, at 1100 px and at the pane's 384 px. It showed:
- the bot's example ($1,000/month, 10%, 15 years) giving $414,470.35, of which $180,000.00 was put in;
- the stacked yearly chart, with its text summary;
- "Use my numbers" filling both fields, with the note "…average saved over Jun–Aug";
- 61 years showing the api's message while keeping the last result ("Showing the last valid result");
- an emptied field asking for all four;
- the table toggling with one row per year.

**Review** (a combined spec and quality pass): compliant; all 12 maths mutants were caught. Fixed in `e1416e9` and `13d8b53`:
- **Stale replies:** an invalid input now drops any reply still in flight, and clears "Calculating…".
- **Validation boundaries are pinned:** 0% (the bot's old refusal), 100%, 1 and 60 years, and 1e12. So are a negative monthly deposit, an empty value and a repeated parameter.
- **"My numbers":** tests now pin whole calendar months late in a month, a zero average with activity, and averaging over 3 months even when one had no activity.
- **Web polish:**
  - "Use my numbers" can't overwrite typing in progress;
  - the note states one amount;
  - the figures are read together with their labels;
  - the chart's axis and tooltip show money;
  - the table scrolls by keyboard;
  - "After 1 year" is singular.

Final: api 57 suites / 615 tests, web build clean with zero warnings.

## Follow-ups

- **The api runs in UTC; you live in UTC−4.** From 8 pm your time on the last day of a month, the server-local "month" is already the next one. That affects Statistics, budgets, the monthly email, Compare, Tips and this calculator. Fix: set `TZ=America/Santo_Domingo` on the api Deployment (a Secret-free manifest change), then check the weekly email's explicit UTC−4 arithmetic still agrees.
- **Huge results use E notation.** Beyond 1e22, Angular's currency pipe shows E notation (for example $1 at 100% for 60 years). The results stay finite (at worst 1.4e38). Capping them would be a spec change.

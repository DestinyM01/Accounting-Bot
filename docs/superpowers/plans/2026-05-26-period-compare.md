# Period Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New "Compare" page where the user picks two months and gets side-by-side summaries plus an AI narrative from Mistral comparing the two periods.

**Architecture:** New `compare` NestJS module with two endpoints: `GET /compare/months` (distinct months that have transaction data, for populating the dropdowns) and `POST /compare` (builds PeriodSummary for each month, calls `mistral-small-latest`, returns both summaries + analysis string). New Angular standalone component following the same patterns as the Recurring and Tips pages.

**Tech Stack:** NestJS 10, Mongoose aggregation, `@mistralai/mistralai`, Angular 17 standalone, `FormsModule` for `[(ngModel)]`, Jest 29 + `@nestjs/testing` (Jest already set up in Plan 1)

**Prerequisite:** Plan 1 (csv-export) must be completed first — Jest is set up there.

---

### Task 1: Create CompareService with tests (TDD)

**Files:**
- Create: `api/src/compare/compare.service.ts`
- Create: `api/src/compare/compare.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `api/src/compare/compare.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CompareService } from './compare.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const MAY_TXS = [
  { amount: 1000, category: 'salary',    timestamp: new Date('2026-05-15') },
  { amount: -200, category: 'food',      timestamp: new Date('2026-05-10') },
  { amount: -150, category: 'transport', timestamp: new Date('2026-05-12') },
  { amount:  -50, category: 'food',      timestamp: new Date('2026-05-20') },
];

let leanResult: any[] = MAY_TXS;

const mockModel = {
  find:      jest.fn(function() { return this; }),
  select:    jest.fn(function() { return this; }),
  lean:      jest.fn(() => Promise.resolve(leanResult)),
  aggregate: jest.fn().mockResolvedValue([
    { _id: { year: 2026, month: 5 } },
    { _id: { year: 2026, month: 6 } },
  ]),
};

describe('CompareService', () => {
  let service: CompareService;

  beforeEach(async () => {
    jest.clearAllMocks();
    leanResult = MAY_TXS;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompareService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<CompareService>(CompareService);
    // Inject mock Mistral so tests don't need a real API key
    (service as any).client = {
      chat: {
        complete: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test analysis result' } }],
        }),
      },
    };
  });

  describe('getAvailableMonths', () => {
    it('returns YYYY-MM strings sorted chronologically', async () => {
      const months = await service.getAvailableMonths();
      expect(months).toEqual(['2026-05', '2026-06']);
    });

    it('pads single-digit months with a leading zero', async () => {
      const months = await service.getAvailableMonths();
      expect(months[0]).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('compare', () => {
    it('calculates totalIncome from positive amounts', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.totalIncome).toBe(1000);
    });

    it('calculates totalExpenses as sum of absolute negatives', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.totalExpenses).toBe(400);
    });

    it('calculates net as income minus expenses', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.net).toBe(600);
    });

    it('returns top categories sorted by amount descending', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.topCategories[0].category).toBe('food');
      expect(result.monthA.topCategories[0].amount).toBe(250);
    });

    it('includes at most 3 top categories', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.monthA.topCategories.length).toBeLessThanOrEqual(3);
    });

    it('attaches Mistral analysis to result', async () => {
      const result = await service.compare('2026-05', '2026-05');
      expect(result.analysis).toBe('Test analysis result');
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd api
pnpm test
```

Expected: failures — `Cannot find module './compare.service'`.

- [ ] **Step 3: Create CompareService**

Create `api/src/compare/compare.service.ts`:

```typescript
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Mistral } from '@mistralai/mistralai';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface PeriodSummary {
  month: string;
  totalIncome: number;
  totalExpenses: number;
  net: number;
  topCategories: { category: string; amount: number }[];
}

export interface CompareResult {
  monthA:   PeriodSummary;
  monthB:   PeriodSummary;
  analysis: string;
}

@Injectable()
export class CompareService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
  private client: Mistral | null = null;

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
  ) {
    if (process.env.MISTRAL_API_KEY) {
      this.client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
    }
  }

  async getAvailableMonths(): Promise<string[]> {
    const results = await this.txModel.aggregate([
      { $match: { userId: this.userId } },
      {
        $group: {
          _id: { year: { $year: '$timestamp' }, month: { $month: '$timestamp' } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);
    return results.map(r =>
      `${r._id.year}-${String(r._id.month).padStart(2, '0')}`
    );
  }

  async compare(monthA: string, monthB: string): Promise<CompareResult> {
    const [summaryA, summaryB] = await Promise.all([
      this.buildPeriodSummary(monthA),
      this.buildPeriodSummary(monthB),
    ]);
    const analysis = await this.callMistral(summaryA, summaryB);
    return { monthA: summaryA, monthB: summaryB, analysis };
  }

  private async buildPeriodSummary(month: string): Promise<PeriodSummary> {
    const [year, m] = month.split('-').map(Number);
    const start = new Date(year, m - 1, 1);
    const end   = new Date(year, m,     1);

    const txs = await this.txModel
      .find({ userId: this.userId, timestamp: { $gte: start, $lt: end } })
      .select('amount category')
      .lean();

    const totalIncome   = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    const catMap: Record<string, number> = {};
    for (const t of txs.filter(t => t.amount < 0)) {
      const cat = t.category || 'other';
      catMap[cat] = (catMap[cat] || 0) + Math.abs(t.amount);
    }
    const topCategories = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, amount]) => ({ category, amount }));

    return { month, totalIncome, totalExpenses, net: totalIncome - totalExpenses, topCategories };
  }

  private async callMistral(a: PeriodSummary, b: PeriodSummary): Promise<string> {
    if (!this.client) throw new InternalServerErrorException('MISTRAL_API_KEY is not configured');

    const fmt = (s: PeriodSummary) =>
      `${s.month}: Income $${s.totalIncome.toFixed(2)}, Expenses $${s.totalExpenses.toFixed(2)}, Net $${s.net.toFixed(2)}` +
      (s.topCategories.length
        ? `. Top: ${s.topCategories.map(c => `${c.category} $${c.amount.toFixed(2)}`).join(', ')}`
        : '');

    const prompt = `You are a personal finance advisor. Compare these two months and give 3-4 sentences of specific, actionable advice:\n\nPeriod A — ${fmt(a)}\nPeriod B — ${fmt(b)}`;

    try {
      const response = await this.client.chat.complete({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
      });
      return (response.choices?.[0]?.message?.content as string) ?? '';
    } catch (err) {
      throw new InternalServerErrorException('Failed to generate comparison');
    }
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd api
pnpm test
```

Expected: all compare + existing transactions tests pass.

---

### Task 2: Create CompareController and CompareModule

**Files:**
- Create: `api/src/compare/compare.controller.ts`
- Create: `api/src/compare/compare.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Create controller**

Create `api/src/compare/compare.controller.ts`:

```typescript
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CompareService, CompareResult } from './compare.service';

@Controller('compare')
@UseGuards(JwtAuthGuard)
export class CompareController {
  constructor(private readonly compareService: CompareService) {}

  @Get('months')
  getMonths(): Promise<string[]> {
    return this.compareService.getAvailableMonths();
  }

  @Post()
  compare(@Body() dto: { monthA: string; monthB: string }): Promise<CompareResult> {
    return this.compareService.compare(dto.monthA, dto.monthB);
  }
}
```

- [ ] **Step 2: Create module**

Create `api/src/compare/compare.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { CompareController } from './compare.controller';
import { CompareService } from './compare.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Transaction.name, schema: TransactionSchema }]),
  ],
  controllers: [CompareController],
  providers:   [CompareService],
})
export class CompareModule {}
```

- [ ] **Step 3: Register in app.module.ts**

In `api/src/app.module.ts`, add `CompareModule` import:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { BalanceModule } from './balance/balance.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BudgetModule } from './budget/budget.module';
import { StatisticsModule } from './statistics/statistics.module';
import { TipsModule } from './tips/tips.module';
import { RecurringModule } from './recurring/recurring.module';
import { CompareModule } from './compare/compare.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGO_URI || 'mongodb://mongodb-svc:27017/accbot',
    ),
    AuthModule,
    BalanceModule,
    TransactionsModule,
    BudgetModule,
    StatisticsModule,
    TipsModule,
    RecurringModule,
    CompareModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 4: Build API**

```bash
cd api
pnpm run build
```

Expected: clean build, no errors.

---

### Task 3: Add web models and API service methods

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`

- [ ] **Step 1: Add models**

Append to `web/src/app/core/services/api.models.ts`:

```typescript
export interface PeriodSummary {
  month:          string;
  totalIncome:    number;
  totalExpenses:  number;
  net:            number;
  topCategories:  { category: string; amount: number }[];
}

export interface CompareResult {
  monthA:   PeriodSummary;
  monthB:   PeriodSummary;
  analysis: string;
}
```

- [ ] **Step 2: Add API service methods**

In `web/src/app/core/services/api.service.ts`, add these two imports at the top (add `CompareResult, PeriodSummary` to the existing import from `./api.models`) and add these two methods before the closing brace:

```typescript
  getCompareMonths(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/compare/months`);
  }

  compare(monthA: string, monthB: string): Observable<CompareResult> {
    return this.http.post<CompareResult>(`${this.base}/compare`, { monthA, monthB });
  }
```

Also update the import line at the top of `api.service.ts` to include the new types:

```typescript
import {
  BalanceSummary,
  BudgetEntry,
  CategoryPoint,
  CompareResult,
  MonthlyPoint,
  MonthlySummary,
  RecurringEntry,
  Tip,
  TransactionPage,
} from './api.models';
```

---

### Task 4: Create Compare Angular component

**Files:**
- Create: `web/src/app/pages/compare/compare.component.ts`
- Create: `web/src/app/pages/compare/compare.component.html`
- Create: `web/src/app/pages/compare/compare.component.scss`

- [ ] **Step 1: Create component TS**

Create `web/src/app/pages/compare/compare.component.ts`:

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { CompareResult } from '../../core/services/api.models';

const CAT_COLORS: Record<string, string> = {
  food: '#f59e0b', transport: '#38bdf8', housing: '#a78bfa',
  health: '#34d399', entertainment: '#f87171',
  salary: '#10e5a0', savings: '#3b82f6', other: '#94a3b8',
};

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.scss'],
})
export class CompareComponent implements OnInit {
  availableMonths: string[] = [];
  monthA    = '';
  monthB    = '';
  comparing = false;
  result:   CompareResult | null = null;
  error     = '';

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getCompareMonths().subscribe({
      next: (months) => { this.availableMonths = months; },
      error: () => {},
    });
  }

  get canCompare(): boolean {
    return !!this.monthA && !!this.monthB && this.monthA !== this.monthB;
  }

  compare() {
    this.comparing = true;
    this.error     = '';
    this.result    = null;
    this.api.compare(this.monthA, this.monthB).subscribe({
      next:  (res) => { this.result = res; this.comparing = false; },
      error: ()    => {
        this.error     = 'Failed to compare periods. Please try again.';
        this.comparing = false;
      },
    });
  }

  formatMonth(ym: string): string {
    const [year, month] = ym.split('-').map(Number);
    return new Date(year, month - 1, 1)
      .toLocaleString('en', { month: 'long', year: 'numeric' });
  }

  catColor(cat: string): string {
    return CAT_COLORS[cat.toLowerCase()] ?? CAT_COLORS['other'];
  }
}
```

- [ ] **Step 2: Create component HTML**

Create `web/src/app/pages/compare/compare.component.html`:

```html
<div class="cp-page">

  <!-- Header -->
  <div class="cp-header">
    <h1>Period Compare</h1>
    <p class="cp-subtitle">AI-powered comparison of two financial months</p>
  </div>

  <!-- Pickers -->
  <div class="pickers-card">
    <div class="pickers-row">

      <div class="picker-group">
        <label class="picker-label">Period A</label>
        <select class="picker-select" [(ngModel)]="monthA">
          <option value="">Select month…</option>
          @for (m of availableMonths; track m) {
            <option [value]="m">{{ formatMonth(m) }}</option>
          }
        </select>
      </div>

      <div class="picker-vs">VS</div>

      <div class="picker-group">
        <label class="picker-label">Period B</label>
        <select class="picker-select" [(ngModel)]="monthB">
          <option value="">Select month…</option>
          @for (m of availableMonths; track m) {
            <option [value]="m">{{ formatMonth(m) }}</option>
          }
        </select>
      </div>

      <button class="compare-btn"
              [disabled]="!canCompare || comparing"
              (click)="compare()">
        <mat-icon [class.spin]="comparing">{{ comparing ? 'autorenew' : 'compare_arrows' }}</mat-icon>
        {{ comparing ? 'Analyzing…' : 'Compare' }}
      </button>

    </div>
  </div>

  <!-- Error -->
  @if (error) {
    <div class="empty-state">
      <mat-icon class="empty-icon error-icon">error_outline</mat-icon>
      <p>{{ error }}</p>
      <button class="retry-btn" (click)="compare()">Try Again</button>
    </div>
  }

  <!-- Results -->
  @if (result) {
    <div class="summary-row">
      @for (period of [result.monthA, result.monthB]; track period.month) {
        <div class="period-card">
          <div class="period-month">{{ formatMonth(period.month) }}</div>

          <div class="period-stats">
            <div class="stat-row">
              <span class="stat-label">Income</span>
              <span class="stat-value income">+{{ period.totalIncome | currency:'USD':'symbol':'1.2-2' }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Expenses</span>
              <span class="stat-value expense">-{{ period.totalExpenses | currency:'USD':'symbol':'1.2-2' }}</span>
            </div>
            <div class="stat-row net-row">
              <span class="stat-label">Net</span>
              <span class="stat-value"
                    [class.income]="period.net >= 0"
                    [class.expense]="period.net < 0">
                {{ period.net | currency:'USD':'symbol':'1.2-2' }}
              </span>
            </div>
          </div>

          @if (period.topCategories.length) {
            <div class="top-cats">
              <span class="top-cats-label">Top Categories</span>
              @for (cat of period.topCategories; track cat.category) {
                <div class="cat-row">
                  <span class="cat-dot" [style.background]="catColor(cat.category)"></span>
                  <span class="cat-name">{{ cat.category | titlecase }}</span>
                  <span class="cat-amount">{{ cat.amount | currency:'USD':'symbol':'1.0-0' }}</span>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- AI Analysis -->
    <div class="analysis-panel">
      <div class="analysis-header">
        <mat-icon class="analysis-icon">psychology</mat-icon>
        <span class="analysis-title">AI Analysis</span>
      </div>
      <p class="analysis-text">{{ result.analysis }}</p>
    </div>
  }

</div>
```

- [ ] **Step 3: Create component SCSS**

Create `web/src/app/pages/compare/compare.component.scss`:

```scss
.cp-page {
  padding: 28px;
  max-width: 1000px;
}

.cp-header {
  margin-bottom: 28px;
  h1 { font-size: 1.75rem; font-weight: 700; color: var(--text); margin: 0 0 4px; }
}
.cp-subtitle { font-size: 0.875rem; color: var(--text-muted); margin: 0; }

// ── Pickers ───────────────────────────────────────────────────────────────
.pickers-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 20px;
}

.pickers-row {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
}

.picker-group { display: flex; flex-direction: column; gap: 6px; }

.picker-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
  color: var(--text-muted);
}

.picker-select {
  appearance: none;
  background: var(--bg-card-alt);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 0.875rem;
  font-family: 'Inter', sans-serif;
  padding: 10px 16px;
  outline: none;
  cursor: pointer;
  min-width: 180px;
  transition: border-color 0.15s;
  &:focus { border-color: var(--accent); }
}

.picker-vs {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-muted);
  padding-bottom: 10px;
}

.compare-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 22px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Inter', sans-serif;
  cursor: pointer;
  transition: opacity 0.13s;
  mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
  &:hover:not(:disabled) { opacity: 0.85; }
  &:disabled { opacity: 0.4; cursor: default; }
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }

// ── Summary cards ─────────────────────────────────────────────────────────
.summary-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.period-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}

.period-month { font-size: 1rem; font-weight: 700; color: var(--text); margin-bottom: 16px; }

.period-stats { display: flex; flex-direction: column; gap: 10px; }

.stat-row { display: flex; justify-content: space-between; align-items: center; }

.stat-label { font-size: 0.8rem; color: var(--text-muted); }

.stat-value {
  font-size: 0.95rem;
  font-weight: 700;
  &.income  { color: var(--income); }
  &.expense { color: var(--expense); }
}

.net-row {
  padding-top: 10px;
  border-top: 1px solid var(--border);
  .stat-value { font-size: 1.1rem; }
}

.top-cats {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.top-cats-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.cat-row { display: flex; align-items: center; gap: 8px; }
.cat-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.cat-name { flex: 1; font-size: 0.83rem; color: var(--text); }
.cat-amount { font-size: 0.83rem; font-weight: 600; color: var(--text-muted); }

// ── Analysis panel ────────────────────────────────────────────────────────
.analysis-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}

.analysis-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }

.analysis-icon { color: var(--accent); font-size: 1.4rem; width: 1.4rem; height: 1.4rem; }

.analysis-title { font-size: 0.9rem; font-weight: 700; color: var(--text); }

.analysis-text {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-muted);
  margin: 0;
  white-space: pre-wrap;
}

// ── Empty / Error ─────────────────────────────────────────────────────────
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
  gap: 12px;
  color: var(--text-muted);
  text-align: center;
  p { font-size: 0.92rem; margin: 0; }
}

.empty-icon { font-size: 3rem; width: 3rem; height: 3rem; opacity: 0.3; color: var(--text); }
.error-icon { color: var(--expense); opacity: 0.7 !important; }

.retry-btn {
  padding: 8px 18px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { opacity: 0.85; }
}
```

---

### Task 5: Register route and nav item

**Files:**
- Modify: `web/src/app/app.routes.ts`
- Modify: `web/src/app/app.component.ts`

- [ ] **Step 1: Add route**

In `web/src/app/app.routes.ts`, add after the `statistics` route:

```typescript
  {
    path: 'compare',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/compare/compare.component').then((m) => m.CompareComponent),
  },
```

- [ ] **Step 2: Add nav item**

In `web/src/app/app.component.ts`, insert in the `navItems` array after the Statistics entry:

```typescript
    { label: 'Compare',    icon: 'compare_arrows', path: '/compare'    },
```

The full `navItems` array should now be:

```typescript
  navItems = [
    { label: 'Dashboard',    icon: 'dashboard',              path: '/dashboard'    },
    { label: 'Transactions', icon: 'receipt_long',           path: '/transactions' },
    { label: 'Budget',       icon: 'account_balance_wallet', path: '/budget'       },
    { label: 'Statistics',   icon: 'bar_chart',              path: '/statistics'   },
    { label: 'Compare',      icon: 'compare_arrows',         path: '/compare'      },
    { label: 'Recurring',    icon: 'repeat',                 path: '/recurring'    },
    { label: 'Tips',         icon: 'lightbulb',              path: '/tips'         },
  ];
```

---

### Task 6: Build and commit

- [ ] **Step 1: Run API tests one last time**

```bash
cd api
pnpm test
```

Expected: all tests pass (transactions + compare).

- [ ] **Step 2: Production build of web**

```bash
cd web
CI=true pnpm run build:prod
```

Expected: clean build, `chunk-...-compare-component.js` in lazy chunk output.

- [ ] **Step 3: Commit**

```bash
git add api/src/compare/ \
        api/src/app.module.ts \
        web/src/app/core/services/api.models.ts \
        web/src/app/core/services/api.service.ts \
        web/src/app/pages/compare/ \
        web/src/app/app.routes.ts \
        web/src/app/app.component.ts
git commit -m "feat: Period Compare page with Mistral AI analysis"
git push
```

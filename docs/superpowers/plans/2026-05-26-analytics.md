# Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New "Analytics" page showing the top-10 most frequent transactions in a ranked table, with a bar chart that loads below when a row is clicked.

**Architecture:** New `analytics` NestJS module with two endpoints: `GET /analytics/top10` (MongoDB aggregation by transactionName) and `GET /analytics/chart/:name` (monthly totals for a specific name). New Angular standalone component using `Chart.js` directly via canvas refs, matching the existing Statistics page pattern.

**Tech Stack:** NestJS 10, Mongoose aggregation pipeline, Angular 17 standalone, `Chart.js` (already installed), Jest 29 + `@nestjs/testing` (set up in Plan 1)

**Prerequisite:** Plan 1 (csv-export) must be completed first for Jest. Plan 2 (period-compare) must be completed for the nav order to be correct — Analytics goes after Compare.

---

### Task 1: Create AnalyticsService with tests (TDD)

**Files:**
- Create: `api/src/analytics/analytics.service.ts`
- Create: `api/src/analytics/analytics.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `api/src/analytics/analytics.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AnalyticsService } from './analytics.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const mockAggregateResult = [
  { _id: 'Netflix',   count: 12, totalAmount: 120 },
  { _id: 'Groceries', count:  8, totalAmount: 400 },
];

const mockChartTxs = [
  { amount: -10, timestamp: new Date('2026-03-15') },
  { amount: -15, timestamp: new Date('2026-03-20') },
  { amount: -10, timestamp: new Date('2026-04-10') },
  { amount: -10, timestamp: new Date('2026-05-05') },
];

const mockModel = {
  aggregate: jest.fn().mockResolvedValue(mockAggregateResult),
  find:      jest.fn(function() { return this; }),
  select:    jest.fn(function() { return this; }),
  lean:      jest.fn().mockResolvedValue(mockChartTxs),
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getTop10', () => {
    it('assigns rank starting at 1', async () => {
      const result = await service.getTop10();
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
    });

    it('maps _id to name', async () => {
      const result = await service.getTop10();
      expect(result[0].name).toBe('Netflix');
    });

    it('returns count from aggregate', async () => {
      const result = await service.getTop10();
      expect(result[0].count).toBe(12);
    });

    it('returns totalAmount from aggregate', async () => {
      const result = await service.getTop10();
      expect(result[0].totalAmount).toBe(120);
    });
  });

  describe('getTransactionChart', () => {
    it('returns one entry per distinct month', async () => {
      const result = await service.getTransactionChart('Netflix');
      expect(result).toHaveLength(3); // mar, apr, may
    });

    it('sorts months chronologically', async () => {
      const result = await service.getTransactionChart('Netflix');
      expect(result[0].month).toBe('2026-03');
      expect(result[1].month).toBe('2026-04');
      expect(result[2].month).toBe('2026-05');
    });

    it('sums amounts within the same month', async () => {
      const result = await service.getTransactionChart('Netflix');
      expect(result[0].total).toBe(25); // 10 + 15 from March
    });

    it('uses absolute amounts', async () => {
      const result = await service.getTransactionChart('Netflix');
      result.forEach(p => expect(p.total).toBeGreaterThan(0));
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd api
pnpm test
```

Expected: failures — `Cannot find module './analytics.service'`.

- [ ] **Step 3: Create AnalyticsService**

Create `api/src/analytics/analytics.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface TopTransaction {
  rank:        number;
  name:        string;
  count:       number;
  totalAmount: number;
}

export interface ChartPoint {
  month: string;
  total: number;
}

@Injectable()
export class AnalyticsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
  ) {}

  async getTop10(): Promise<TopTransaction[]> {
    const results = await this.txModel.aggregate([
      { $match: { userId: this.userId } },
      {
        $group: {
          _id:         '$transactionName',
          count:       { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    return results.map((r, i) => ({
      rank:        i + 1,
      name:        r._id,
      count:       r.count,
      totalAmount: r.totalAmount,
    }));
  }

  async getTransactionChart(name: string): Promise<ChartPoint[]> {
    const txs = await this.txModel
      .find({ userId: this.userId, transactionName: name })
      .select('timestamp amount')
      .lean();

    const monthMap: Record<string, number> = {};
    for (const t of txs) {
      const d   = new Date(t.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = (monthMap[key] || 0) + Math.abs(t.amount);
    }

    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd api
pnpm test
```

Expected: all analytics + previous tests pass.

---

### Task 2: Create AnalyticsController and AnalyticsModule

**Files:**
- Create: `api/src/analytics/analytics.controller.ts`
- Create: `api/src/analytics/analytics.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Create controller**

Create `api/src/analytics/analytics.controller.ts`:

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AnalyticsService, TopTransaction, ChartPoint } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('top10')
  getTop10(): Promise<TopTransaction[]> {
    return this.analyticsService.getTop10();
  }

  @Get('chart/:name')
  getChart(@Param('name') name: string): Promise<ChartPoint[]> {
    return this.analyticsService.getTransactionChart(name);
  }
}
```

- [ ] **Step 2: Create module**

Create `api/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Transaction.name, schema: TransactionSchema }]),
  ],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 3: Register in app.module.ts**

In `api/src/app.module.ts`, add `AnalyticsModule` (keep all existing imports, add one more):

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
import { AnalyticsModule } from './analytics/analytics.module';
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
    AnalyticsModule,
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

Expected: clean build.

---

### Task 3: Add web models and API service methods

**Files:**
- Modify: `web/src/app/core/services/api.models.ts`
- Modify: `web/src/app/core/services/api.service.ts`

- [ ] **Step 1: Add models**

Append to `web/src/app/core/services/api.models.ts`:

```typescript
export interface TopTransaction {
  rank:        number;
  name:        string;
  count:       number;
  totalAmount: number;
}

export interface ChartPoint {
  month: string;
  total: number;
}
```

- [ ] **Step 2: Add API service methods**

In `web/src/app/core/services/api.service.ts`, add `TopTransaction, ChartPoint` to the import from `./api.models` and add these two methods before the closing brace:

```typescript
  getTop10(): Observable<TopTransaction[]> {
    return this.http.get<TopTransaction[]>(`${this.base}/analytics/top10`);
  }

  getTransactionChart(name: string): Observable<ChartPoint[]> {
    return this.http.get<ChartPoint[]>(`${this.base}/analytics/chart/${encodeURIComponent(name)}`);
  }
```

---

### Task 4: Create Analytics Angular component

**Files:**
- Create: `web/src/app/pages/analytics/analytics.component.ts`
- Create: `web/src/app/pages/analytics/analytics.component.html`
- Create: `web/src/app/pages/analytics/analytics.component.scss`

- [ ] **Step 1: Create component TS**

Create `web/src/app/pages/analytics/analytics.component.ts`:

```typescript
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { ChartPoint, TopTransaction } from '../../core/services/api.models';

Chart.register(...registerables);

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  top10:        TopTransaction[] = [];
  selectedName  = '';
  chartLoading  = false;
  loading       = true;
  error         = '';
  private chart: Chart | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getTop10().subscribe({
      next:  (data) => { this.top10 = data; this.loading = false; },
      error: ()     => { this.error = 'Failed to load analytics.'; this.loading = false; },
    });
  }

  ngOnDestroy() {
    if (this.chart) { this.chart.destroy(); }
  }

  selectTransaction(name: string) {
    if (this.selectedName === name) return;
    this.selectedName = name;
    this.chartLoading = true;
    this.api.getTransactionChart(name).subscribe({
      next:  (points) => { this.chartLoading = false; setTimeout(() => this.buildChart(points), 0); },
      error: ()       => { this.chartLoading = false; },
    });
  }

  private buildChart(points: ChartPoint[]) {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas) return;

    this.chart = new Chart(canvas.getContext('2d')!, {
      type: 'bar',
      data: {
        labels:   points.map(p => p.month),
        datasets: [{
          data:            points.map(p => p.total),
          backgroundColor: points.map((_, i, arr) =>
            i === arr.length - 1 ? '#10e5a0' : 'rgba(16,229,160,0.35)'
          ),
          borderRadius: 4,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: {
            backgroundColor: '#0e1726',
            borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
            titleColor: '#94a3b8', bodyColor: '#e2e8f0',
          },
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
        },
      },
    });
  }
}
```

- [ ] **Step 2: Create component HTML**

Create `web/src/app/pages/analytics/analytics.component.html`:

```html
<div class="an-page">

  <!-- Header -->
  <div class="an-header">
    <h1>Analytics</h1>
    <p class="an-subtitle">Top transactions and spending trends</p>
  </div>

  <!-- Loading skeleton -->
  @if (loading) {
    <div class="skeleton-panel">
      @for (_ of [1,2,3,4,5]; track $index) {
        <div class="sk-row"></div>
      }
    </div>
  }

  <!-- Error -->
  @if (!loading && error) {
    <div class="empty-state">
      <mat-icon class="empty-icon error-icon">error_outline</mat-icon>
      <p>{{ error }}</p>
    </div>
  }

  @if (!loading && !error) {

    <!-- Top 10 table -->
    <div class="an-panel">
      <div class="panel-header">
        <span class="panel-title">Top 10 Transactions</span>
        <span class="panel-sub">by frequency · all time</span>
      </div>
      <div class="table-head">
        <span>#</span>
        <span>Name</span>
        <span>Count</span>
        <span class="align-right">Total</span>
      </div>
      @for (item of top10; track item.name) {
        <div class="table-row"
             [class.active]="selectedName === item.name"
             (click)="selectTransaction(item.name)">
          <span class="rank-badge">{{ item.rank }}</span>
          <span class="tx-name">{{ item.name | titlecase }}</span>
          <span class="tx-count">{{ item.count }}×</span>
          <span class="tx-amount align-right">{{ item.totalAmount | currency:'USD':'symbol':'1.2-2' }}</span>
        </div>
      }
      @if (top10.length === 0) {
        <div class="empty-state-inline"><p>No transactions yet.</p></div>
      }
    </div>

    <!-- Chart panel -->
    <div class="chart-panel">
      @if (!selectedName) {
        <div class="chart-empty">
          <mat-icon class="chart-empty-icon">touch_app</mat-icon>
          <p>Select a transaction above to see its history</p>
        </div>
      } @else if (chartLoading) {
        <div class="chart-skeleton"></div>
      } @else {
        <div class="chart-header">
          <span class="chart-title">{{ selectedName | titlecase }}</span>
          <span class="chart-subtitle">Monthly total</span>
        </div>
        <div class="chart-wrap">
          <canvas #chartCanvas></canvas>
        </div>
      }
    </div>

  }

</div>
```

- [ ] **Step 3: Create component SCSS**

Create `web/src/app/pages/analytics/analytics.component.scss`:

```scss
.an-page {
  padding: 28px;
  max-width: 1000px;
}

.an-header {
  margin-bottom: 28px;
  h1 { font-size: 1.75rem; font-weight: 700; color: var(--text); margin: 0 0 4px; }
}
.an-subtitle { font-size: 0.875rem; color: var(--text-muted); margin: 0; }

// ── Top 10 panel ──────────────────────────────────────────────────────────
.an-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
}

.panel-title { font-size: 1rem; font-weight: 700; color: var(--text); }
.panel-sub   { font-size: 0.75rem; color: var(--text-muted); }

.table-head {
  display: grid;
  grid-template-columns: 48px 1fr 80px 130px;
  padding: 10px 24px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}

.table-row {
  display: grid;
  grid-template-columns: 48px 1fr 80px 130px;
  padding: 14px 24px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.13s;

  &:last-child { border-bottom: none; }
  &:hover      { background: rgba(255,255,255,0.025); }
  &.active {
    background:   rgba(16,229,160,0.06);
    border-left:  3px solid var(--income);
    padding-left: 21px;
  }
}

.rank-badge {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(255,255,255,0.07);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
}

.tx-name   { font-size: 0.9rem; font-weight: 600; color: var(--text); }
.tx-count  { font-size: 0.875rem; color: var(--text-muted); }
.tx-amount { font-size: 0.9rem; font-weight: 700; color: var(--text); }
.align-right { text-align: right; }

.empty-state-inline {
  padding: 32px 24px;
  color: var(--text-muted);
  font-size: 0.875rem;
  text-align: center;
}

// ── Chart panel ───────────────────────────────────────────────────────────
.chart-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.chart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 20px;
  gap: 10px;
  color: var(--text-muted);
  text-align: center;
  p { font-size: 0.875rem; margin: 0; }
}

.chart-empty-icon {
  font-size: 2.5rem;
  width: 2.5rem;
  height: 2.5rem;
  opacity: 0.25;
}

.chart-skeleton {
  height: 220px;
  margin: 16px;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--bg-card-alt) 25%, rgba(255,255,255,0.04) 50%, var(--bg-card-alt) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

.chart-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 24px 0;
}

.chart-title    { font-size: 1rem; font-weight: 700; color: var(--text); }
.chart-subtitle { font-size: 0.78rem; color: var(--text-muted); }

.chart-wrap {
  height: 220px;
  padding: 16px 24px 24px;
}

// ── Skeleton ──────────────────────────────────────────────────────────────
.skeleton-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 24px;
}

.sk-row {
  height: 48px;
  border-radius: 8px;
  margin: 8px 0;
  background: linear-gradient(90deg, var(--bg-card-alt) 25%, rgba(255,255,255,0.04) 50%, var(--bg-card-alt) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

// ── Empty / Error ─────────────────────────────────────────────────────────
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 20px;
  gap: 12px;
  color: var(--text-muted);
  text-align: center;
  p { font-size: 0.92rem; margin: 0; }
}

.empty-icon  { font-size: 3rem; width: 3rem; height: 3rem; opacity: 0.3; color: var(--text); }
.error-icon  { color: var(--expense); opacity: 0.7 !important; }
```

---

### Task 5: Register route and nav item

**Files:**
- Modify: `web/src/app/app.routes.ts`
- Modify: `web/src/app/app.component.ts`

- [ ] **Step 1: Add route**

In `web/src/app/app.routes.ts`, add after the `compare` route:

```typescript
  {
    path: 'analytics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
```

- [ ] **Step 2: Add nav item**

In `web/src/app/app.component.ts`, insert in `navItems` after Compare:

```typescript
  navItems = [
    { label: 'Dashboard',    icon: 'dashboard',              path: '/dashboard'    },
    { label: 'Transactions', icon: 'receipt_long',           path: '/transactions' },
    { label: 'Budget',       icon: 'account_balance_wallet', path: '/budget'       },
    { label: 'Statistics',   icon: 'bar_chart',              path: '/statistics'   },
    { label: 'Compare',      icon: 'compare_arrows',         path: '/compare'      },
    { label: 'Analytics',    icon: 'insights',               path: '/analytics'    },
    { label: 'Recurring',    icon: 'repeat',                 path: '/recurring'    },
    { label: 'Tips',         icon: 'lightbulb',              path: '/tips'         },
  ];
```

---

### Task 6: Build and commit

- [ ] **Step 1: Run all API tests**

```bash
cd api
pnpm test
```

Expected: all tests pass (transactions + compare + analytics).

- [ ] **Step 2: Production build of web**

```bash
cd web
CI=true pnpm run build:prod
```

Expected: clean build, `chunk-...-analytics-component.js` in lazy chunk output.

- [ ] **Step 3: Commit**

```bash
git add api/src/analytics/ \
        api/src/app.module.ts \
        web/src/app/core/services/api.models.ts \
        web/src/app/core/services/api.service.ts \
        web/src/app/pages/analytics/ \
        web/src/app/app.routes.ts \
        web/src/app/app.component.ts
git commit -m "feat: Analytics page — top-10 transactions and per-transaction history chart"
git push
```

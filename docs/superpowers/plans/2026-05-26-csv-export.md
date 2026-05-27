# CSV Export + Transaction Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add date-range and type filters to the Transactions page, then wire up the already-present (disabled) Export CSV button so it downloads all filtered transactions as a CSV file.

**Architecture:** Extend `TransactionsService` with a shared private `buildFilter()` helper used by both the existing `findAll` and a new `exportCsv()` method. Add a `GET /transactions/export` endpoint that streams the CSV with proper `Content-Disposition` headers. On the web, use `HttpClient` with `responseType: 'blob'` so the auth interceptor adds the Bearer token automatically — no `window.open()` tricks needed.

**Tech Stack:** NestJS 10, Mongoose, Express `Response`, Angular 17 standalone components, `HttpClient` blob response, Jest 29 + `@nestjs/testing`, `ts-jest`

---

### Task 1: Set up Jest in the API

**Files:**
- Modify: `api/package.json`

- [ ] **Step 1: Add Jest deps and config to package.json**

Replace the entire `api/package.json` with:

```json
{
  "name": "accounting-api",
  "version": "1.0.0",
  "scripts": {
    "build": "nest build",
    "start:prod": "node dist/main",
    "test": "jest --passWithNoTests",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/mongoose": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "mongoose": "^8.0.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.0",
    "jwks-rsa": "^3.1.0",
    "@mistralai/mistralai": "^1.0.0",
    "rxjs": "^7.8.0",
    "reflect-metadata": "^0.2.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.0.0",
    "@types/passport-jwt": "^4.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Install new dev deps**

```bash
cd api
CI=true pnpm install --no-frozen-lockfile
```

Expected: `@nestjs/testing`, `jest`, `ts-jest`, `@types/jest` installed.

- [ ] **Step 3: Verify test runner works**

```bash
cd api
pnpm test
```

Expected: `No tests found, exiting with code 0` (because `--passWithNoTests`).

---

### Task 2: Add `exportCsv` to TransactionsService (TDD)

**Files:**
- Create: `api/src/transactions/transactions.service.spec.ts`
- Modify: `api/src/transactions/transactions.service.ts`

- [ ] **Step 1: Write failing tests**

Create `api/src/transactions/transactions.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TransactionsService } from './transactions.service';
import { Transaction } from '../shared/schemas/transaction.schema';

const mockTxs = [
  {
    transactionName: 'Groceries',
    transactionType: 'Расход',
    amount: -50,
    timestamp: new Date('2026-05-01'),
    category: 'food',
  },
  {
    transactionName: 'Salary',
    transactionType: 'Доход',
    amount: 1000,
    timestamp: new Date('2026-05-05'),
    category: 'salary',
  },
  {
    transactionName: 'He said, "lunch"',
    transactionType: 'Расход',
    amount: -20,
    timestamp: new Date('2026-05-10'),
    category: 'food',
  },
];

const mockModel = {
  find:           jest.fn(function() { return this; }),
  sort:           jest.fn(function() { return this; }),
  skip:           jest.fn(function() { return this; }),
  limit:          jest.fn(function() { return this; }),
  select:         jest.fn(function() { return this; }),
  lean:           jest.fn().mockResolvedValue(mockTxs),
  countDocuments: jest.fn().mockResolvedValue(mockTxs.length),
};

describe('TransactionsService.exportCsv', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken(Transaction.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<TransactionsService>(TransactionsService);
  });

  it('starts with the header row', async () => {
    const csv = await service.exportCsv({});
    expect(csv.startsWith('Date,Name,Type,Category,Amount\n')).toBe(true);
  });

  it('produces one data row per transaction', async () => {
    const csv = await service.exportCsv({});
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('marks negative amount as expense', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"expense"');
  });

  it('marks positive amount as income', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"income"');
  });

  it('outputs absolute amount with 2 decimals', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"50.00"');
    expect(csv).not.toContain('"-50"');
  });

  it('escapes double-quotes inside names', async () => {
    const csv = await service.exportCsv({});
    expect(csv).toContain('"He said, ""lunch"""');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd api
pnpm test
```

Expected: 6 failures — `exportCsv is not a function`.

- [ ] **Step 3: Update TransactionsService**

Replace `api/src/transactions/transactions.service.ts` entirely:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../shared/schemas/transaction.schema';

export interface TransactionQuery {
  limit?: number;
  offset?: number;
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExportQuery {
  type?: 'income' | 'expense';
  category?: string;
  startDate?: string;
  endDate?: string;
}

export interface TransactionItem {
  _id: unknown;
  transactionName: string;
  transactionType: string;
  amount: number;
  isExpense: boolean;
  timestamp: Date;
  category: string;
}

export interface TransactionPage {
  items: TransactionItem[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class TransactionsService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
  ) {}

  private buildFilter(query: ExportQuery): Record<string, any> {
    const filter: any = { userId: this.userId };
    if (query.type === 'income')  filter.amount = { $gt: 0 };
    if (query.type === 'expense') filter.amount = { $lt: 0 };
    if (query.category) filter.category = query.category;
    if (query.startDate || query.endDate) {
      filter.timestamp = {};
      if (query.startDate) filter.timestamp.$gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }
    return filter;
  }

  async findAll(query: TransactionQuery): Promise<TransactionPage> {
    const filter = this.buildFilter(query);
    const limit  = Math.min(query.limit || 50, 200);
    const offset = query.offset || 0;

    const [items, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .select('transactionName transactionType amount timestamp category')
        .lean(),
      this.transactionModel.countDocuments(filter),
    ]);

    const normalised = items.map((t) => ({
      ...t,
      amount:    Math.abs(t.amount),
      isExpense: t.amount < 0,
    }));

    return { items: normalised, total, limit, offset };
  }

  async exportCsv(query: ExportQuery): Promise<string> {
    const filter = this.buildFilter(query);
    const txs = await this.transactionModel
      .find(filter)
      .sort({ timestamp: -1 })
      .select('transactionName transactionType amount timestamp category')
      .lean();

    const header = 'Date,Name,Type,Category,Amount\n';
    const rows = txs.map((t) => {
      const date   = new Date(t.timestamp).toISOString().slice(0, 10);
      const type   = t.amount < 0 ? 'expense' : 'income';
      const amount = Math.abs(t.amount).toFixed(2);
      const name   = t.transactionName.replace(/"/g, '""');
      return `"${date}","${name}","${type}","${t.category || 'other'}","${amount}"`;
    }).join('\n');

    return header + rows;
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd api
pnpm test
```

Expected: `6 passed`.

---

### Task 3: Add export endpoint to TransactionsController

**Files:**
- Modify: `api/src/transactions/transactions.controller.ts`

- [ ] **Step 1: Update controller**

Replace `api/src/transactions/transactions.controller.ts` entirely:

```typescript
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TransactionsService, TransactionPage } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  findAll(
    @Query('limit')     limit?: string,
    @Query('offset')    offset?: string,
    @Query('type')      type?: 'income' | 'expense',
    @Query('category')  category?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate')   endDate?: string,
  ): Promise<TransactionPage> {
    return this.transactionsService.findAll({
      limit:     limit  ? parseInt(limit, 10)  : undefined,
      offset:    offset ? parseInt(offset, 10) : undefined,
      type,
      category,
      startDate,
      endDate,
    });
  }

  @Get('export')
  async exportCsv(
    @Query('type')      type: string,
    @Query('category')  category: string,
    @Query('startDate') startDate: string,
    @Query('endDate')   endDate: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.transactionsService.exportCsv({
      type:      (type      || undefined) as 'income' | 'expense' | undefined,
      category:  category  || undefined,
      startDate: startDate || undefined,
      endDate:   endDate   || undefined,
    });
    const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
```

- [ ] **Step 2: Build API to verify no TypeScript errors**

```bash
cd api
pnpm run build
```

Expected: no errors, `dist/` updated.

---

### Task 4: Update ApiService and TransactionsComponent (web)

**Files:**
- Modify: `web/src/app/core/services/api.service.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.html`
- Modify: `web/src/app/pages/transactions/transactions.component.scss`

- [ ] **Step 1: Update ApiService**

Replace `web/src/app/core/services/api.service.ts` entirely:

```typescript
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BalanceSummary,
  BudgetEntry,
  CategoryPoint,
  MonthlyPoint,
  MonthlySummary,
  RecurringEntry,
  Tip,
  TransactionPage,
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '/api';

  constructor(private http: HttpClient) {}

  getBalance(): Observable<BalanceSummary> {
    return this.http.get<BalanceSummary>(`${this.base}/balance`);
  }

  getTransactions(opts: {
    limit?:     number;
    offset?:    number;
    type?:      'income' | 'expense';
    category?:  string;
    startDate?: string;
    endDate?:   string;
  } = {}): Observable<TransactionPage> {
    let params = new HttpParams();
    if (opts.limit)     params = params.set('limit',     opts.limit);
    if (opts.offset)    params = params.set('offset',    opts.offset);
    if (opts.type)      params = params.set('type',      opts.type);
    if (opts.category)  params = params.set('category',  opts.category);
    if (opts.startDate) params = params.set('startDate', opts.startDate);
    if (opts.endDate)   params = params.set('endDate',   opts.endDate);
    return this.http.get<TransactionPage>(`${this.base}/transactions`, { params });
  }

  exportTransactions(opts: {
    type?:      'income' | 'expense';
    category?:  string;
    startDate?: string;
    endDate?:   string;
  } = {}): Observable<Blob> {
    let params = new HttpParams();
    if (opts.type)      params = params.set('type',      opts.type);
    if (opts.category)  params = params.set('category',  opts.category);
    if (opts.startDate) params = params.set('startDate', opts.startDate);
    if (opts.endDate)   params = params.set('endDate',   opts.endDate);
    return this.http.get(`${this.base}/transactions/export`, { params, responseType: 'blob' });
  }

  getBudget(month?: number, year?: number): Observable<BudgetEntry[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year',  year);
    return this.http.get<BudgetEntry[]>(`${this.base}/budget`, { params });
  }

  getStatisticsSummary(month?: number, year?: number): Observable<MonthlySummary> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year',  year);
    return this.http.get<MonthlySummary>(`${this.base}/statistics/summary`, { params });
  }

  getMonthlyStats(): Observable<MonthlyPoint[]> {
    return this.http.get<MonthlyPoint[]>(`${this.base}/statistics/monthly`);
  }

  getCategoryStats(month?: number, year?: number): Observable<CategoryPoint[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (year)  params = params.set('year',  year);
    return this.http.get<CategoryPoint[]>(`${this.base}/statistics/by-category`, { params });
  }

  getRecurring(): Observable<RecurringEntry[]> {
    return this.http.get<RecurringEntry[]>(`${this.base}/recurring`);
  }

  getTips(): Observable<Tip[]> {
    return this.http.get<Tip[]>(`${this.base}/tips`);
  }

  refreshTips(): Observable<Tip[]> {
    return this.http.post<Tip[]>(`${this.base}/tips/refresh`, {});
  }
}
```

- [ ] **Step 2: Update TransactionsComponent TS**

Replace `web/src/app/pages/transactions/transactions.component.ts` entirely:

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Transaction, TransactionPage } from '../../core/services/api.models';

const CATEGORIES = ['food','transport','housing','health','entertainment','salary','savings','other'];

const CAT_COLORS: Record<string, string> = {
  housing:'#38bdf8', food:'#10e5a0', transport:'#fb923c',
  health:'#a78bfa', entertainment:'#f472b6', salary:'#10e5a0',
  savings:'#34d399', other:'#94a3b8',
};

const CAT_ICONS: Record<string, string> = {
  housing:'home', food:'restaurant', transport:'directions_car',
  health:'medical_services', entertainment:'movie', salary:'payments',
  savings:'savings', other:'receipt_long',
};

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, TitleCasePipe, FormsModule,
            MatIconModule, MatSelectModule],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
})
export class TransactionsComponent implements OnInit {
  items:       Transaction[] = [];
  total        = 0;
  offset       = 0;
  limit        = 20;
  loading      = true;
  loadingMore  = false;

  search         = '';
  categoryFilter = '';
  typeFilter:    '' | 'income' | 'expense' = '';
  startDate      = '';
  endDate        = '';
  categories     = CATEGORIES;

  private search$ = new Subject<string>();

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => { this.offset = 0; this.load(false); });
    this.load(false);
  }

  load(append: boolean) {
    if (append) this.loadingMore = true;
    else        this.loading     = true;

    this.api.getTransactions({
      limit:     this.limit,
      offset:    this.offset,
      category:  this.categoryFilter || undefined,
      type:      (this.typeFilter as 'income' | 'expense') || undefined,
      startDate: this.startDate || undefined,
      endDate:   this.endDate   || undefined,
    }).subscribe({
      next: (page: TransactionPage) => {
        this.items   = append ? [...this.items, ...page.items] : page.items;
        this.total   = page.total;
        this.loading = this.loadingMore = false;
      },
      error: () => { this.loading = this.loadingMore = false; },
    });
  }

  onSearch()         { this.search$.next(this.search); }
  onCategoryChange() { this.offset = 0; this.load(false); }
  onTypeChange()     { this.offset = 0; this.load(false); }
  onDateChange()     { this.offset = 0; this.load(false); }

  loadMore() { this.offset += this.limit; this.load(true); }

  get hasMore() { return this.offset + this.limit < this.total; }

  get filtered(): Transaction[] {
    if (!this.search.trim()) return this.items;
    const q = this.search.toLowerCase();
    return this.items.filter(t =>
      t.transactionName.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }

  exportCsv() {
    this.api.exportTransactions({
      type:      (this.typeFilter as 'income' | 'expense') || undefined,
      category:  this.categoryFilter || undefined,
      startDate: this.startDate || undefined,
      endDate:   this.endDate   || undefined,
    }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href    = url;
        a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {},
    });
  }

  catColor(cat: string) { return CAT_COLORS[cat.toLowerCase()] ?? '#64748b'; }
  catIcon(cat: string)  { return CAT_ICONS[cat.toLowerCase()]  ?? 'category'; }
}
```

- [ ] **Step 3: Update HTML — add type + date filters and fix export button**

In `web/src/app/pages/transactions/transactions.component.html`, replace the `<!-- Filters row -->` card:

```html
  <!-- Filters row -->
  <div class="card filters-card">
    <div class="filters-row">
      <div class="search-wrap">
        <mat-icon class="search-icon">search</mat-icon>
        <input class="search-input"
               [(ngModel)]="search"
               (input)="onSearch()"
               placeholder="Search transactions…" />
      </div>

      <div class="filter-group">
        <label class="filter-label">Category</label>
        <select class="filter-select" [(ngModel)]="categoryFilter" (change)="onCategoryChange()">
          <option value="">All Categories</option>
          @for (cat of categories; track cat) {
            <option [value]="cat">{{ cat | titlecase }}</option>
          }
        </select>
        <mat-icon class="select-chevron">expand_more</mat-icon>
      </div>

      <div class="filter-group">
        <label class="filter-label">Type</label>
        <select class="filter-select type-select" [(ngModel)]="typeFilter" (change)="onTypeChange()">
          <option value="">All Types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <mat-icon class="select-chevron">expand_more</mat-icon>
      </div>

      <div class="filter-group">
        <label class="filter-label">From</label>
        <input class="filter-date" type="date" [(ngModel)]="startDate" (change)="onDateChange()" />
      </div>

      <div class="filter-group">
        <label class="filter-label">To</label>
        <input class="filter-date" type="date" [(ngModel)]="endDate" (change)="onDateChange()" />
      </div>

      <button class="export-btn" (click)="exportCsv()">
        <mat-icon>download</mat-icon>
        Export CSV
      </button>
    </div>
  </div>
```

- [ ] **Step 4: Update SCSS — fix export-btn and add date input style**

In `web/src/app/pages/transactions/transactions.component.scss`, replace the `.export-btn` block:

```scss
.export-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 0.875rem;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.13s;
  mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
  &:hover { opacity: 0.85; }
}
```

After the `.select-chevron` block, add:

```scss
.type-select { min-width: 120px; }

.filter-date {
  appearance: none;
  background: var(--bg-card-alt);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 0.875rem;
  font-family: 'Inter', sans-serif;
  padding: 9px 14px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s;
  &:focus { border-color: var(--accent); }
  &::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
}
```

---

### Task 5: Build and commit

- [ ] **Step 1: Production build**

```bash
cd web
CI=true pnpm run build:prod
```

Expected: clean build, `chunk-...-transactions-component.js` in output.

- [ ] **Step 2: Commit**

```bash
git add api/package.json api/pnpm-lock.yaml \
        api/src/transactions/transactions.service.ts \
        api/src/transactions/transactions.service.spec.ts \
        api/src/transactions/transactions.controller.ts \
        web/src/app/core/services/api.service.ts \
        web/src/app/pages/transactions/transactions.component.ts \
        web/src/app/pages/transactions/transactions.component.html \
        web/src/app/pages/transactions/transactions.component.scss
git commit -m "feat: transaction filters (type, date range) and CSV export"
git push
```

/**
 * Answers every /api/* call ApiService makes, from the in-memory store in
 * fixtures.ts, so the app can be clicked through and screenshotted with no
 * Authentik and no real api. Routes are matched by method + path (query
 * params come off req.params, since Angular splits them out of req.url).
 * A 150 ms delay on every reply lets skeleton states show, the way the real
 * network would. A path this file doesn't recognize answers 404 and logs a
 * console warning, so a gap here is easy to spot while clicking through.
 */
import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { delay, switchMap } from 'rxjs/operators';
import {
  AccountsSettingsInput,
  BalanceChangeReason,
  CashItemInput,
  CategoryInput,
  CreateRecurringRequest,
  CreateTransactionRequest,
  ReportsSettingsInput,
  SetBudgetRequest,
  UpdateTransactionRequest,
} from '../app/core/services/api.models';
import { store } from './fixtures';

const DELAY_MS = 150;

function reply<T>(body: T, status = 200): Observable<HttpEvent<T>> {
  return of(new HttpResponse<T>({ status, body })).pipe(delay(DELAY_MS));
}

function fail(status: number): Observable<never> {
  return of(null).pipe(
    delay(DELAY_MS),
    switchMap(() => throwError(() => new HttpErrorResponse({ status }))),
  );
}

const num = (params: HttpParams, key: string): number | undefined => {
  const v = params.get(key);
  return v === null || v === '' ? undefined : Number(v);
};
const str = (params: HttpParams, key: string): string | undefined => params.get(key) ?? undefined;
const flag = (params: HttpParams, key: string): boolean => params.get(key) === 'true';

// ── Route patterns ──────────────────────────────────────────────────────
const RE_TX_EXPORT = /^\/api\/transactions\/export$/;
const RE_TX_CATEGORY = /^\/api\/transactions\/([^/]+)\/category$/;
const RE_TX_TRANSFER = /^\/api\/transactions\/([^/]+)\/transfer-kind$/;
const RE_TX_ID = /^\/api\/transactions\/([^/]+)$/;
const RE_TX = /^\/api\/transactions$/;

const RE_CASH_ALLOCATIONS = /^\/api\/cash\/withdrawals\/([^/]+)\/allocations$/;
const RE_CASH_WITHDRAWAL = /^\/api\/cash\/withdrawals\/([^/]+)$/;
const RE_CASH_ALLOCATION_ID = /^\/api\/cash\/allocations\/([^/]+)$/;

const RE_BUDGET = /^\/api\/budget$/;

const RE_STATS_SUMMARY = /^\/api\/statistics\/summary$/;
const RE_STATS_MONTHLY = /^\/api\/statistics\/monthly$/;
const RE_STATS_BY_CATEGORY = /^\/api\/statistics\/by-category$/;

const RE_RECURRING_ID = /^\/api\/recurring\/([^/]+)$/;
const RE_RECURRING = /^\/api\/recurring$/;

const RE_CATEGORY_OVERVIEW = /^\/api\/categories\/overview$/;
const RE_CATEGORY_FINISH = /^\/api\/categories\/([^/]+)\/finish$/;
const RE_CATEGORY_ID = /^\/api\/categories\/([^/]+)$/;
const RE_CATEGORIES = /^\/api\/categories$/;

const RE_TIPS_REFRESH = /^\/api\/tips\/refresh$/;
const RE_TIPS = /^\/api\/tips$/;

const RE_COMPARE_MONTHS = /^\/api\/compare\/months$/;
const RE_COMPARE = /^\/api\/compare$/;

const RE_ANALYTICS_TOP10 = /^\/api\/analytics\/top10$/;
const RE_ANALYTICS_CHART = /^\/api\/analytics\/chart\/([^/]+)$/;

const RE_REPORTS_TEST = /^\/api\/reports\/test$/;

const RE_SETTINGS_REPORTS = /^\/api\/settings\/reports$/;
const RE_SETTINGS_ACCOUNTS = /^\/api\/settings\/accounts$/;
const RE_SETTINGS = /^\/api\/settings$/;

const RE_INGESTION_STATUS = /^\/api\/ingestion\/status$/;
const RE_INGESTION_RUN = /^\/api\/ingestion\/run$/;
const RE_INGESTION_DISMISS = /^\/api\/ingestion\/unreadable\/([^/]+)\/dismiss$/;

const RE_CALC_COMPOUND = /^\/api\/calculator\/compound$/;
const RE_CALC_MINE = /^\/api\/calculator\/my-numbers$/;

const RE_MERCHANTS_MATCH = /^\/api\/merchants\/match$/;
const RE_MERCHANT_ID = /^\/api\/merchants\/([^/]+)$/;
const RE_MERCHANTS = /^\/api\/merchants$/;

const RE_BALANCE_HISTORY = /^\/api\/balance\/history$/;
const RE_BALANCE_DAILY = /^\/api\/balance\/daily$/;
const RE_BALANCE = /^\/api\/balance$/;

export const previewApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) return next(req);

  const { method, url, params } = req;
  let m: RegExpExecArray | null;

  // ── Balance ────────────────────────────────────────────────────────
  if (method === 'GET' && RE_BALANCE.test(url)) return reply(store.getBalanceSummary());
  if (method === 'PUT' && RE_BALANCE.test(url)) {
    const body = req.body as { balance: number; note?: string };
    return reply(store.setBalance(body.balance, body.note));
  }
  if (method === 'GET' && RE_BALANCE_HISTORY.test(url)) {
    return reply(
      store.getBalanceHistoryPage({
        limit: num(params, 'limit'),
        offset: num(params, 'offset'),
        before: str(params, 'before'),
        reason: str(params, 'reason') as BalanceChangeReason | undefined,
      }),
    );
  }
  if (method === 'GET' && RE_BALANCE_DAILY.test(url)) return reply(store.getDailyBalance(num(params, 'days') ?? 90));

  // ── Transactions ───────────────────────────────────────────────────
  if (method === 'GET' && RE_TX_EXPORT.test(url)) {
    const csv = store.exportCsv({
      type: str(params, 'type'), category: str(params, 'category'),
      startDate: str(params, 'startDate'), endDate: str(params, 'endDate'), search: str(params, 'search'),
    });
    return reply(new Blob([csv], { type: 'text/csv' }));
  }
  if (method === 'PATCH' && (m = RE_TX_CATEGORY.exec(url))) {
    const body = req.body as { category: string };
    const result = store.setTransactionCategory(m[1], body.category);
    return result ? reply(result) : fail(404);
  }
  if (method === 'PATCH' && (m = RE_TX_TRANSFER.exec(url))) {
    const body = req.body as { kind: 'internal' | 'external' };
    return store.resolveTransfer(m[1], body.kind) ? reply(undefined) : fail(404);
  }
  if (method === 'PUT' && (m = RE_TX_ID.exec(url))) {
    return store.updateTransaction(m[1], req.body as UpdateTransactionRequest) ? reply(undefined) : fail(404);
  }
  if (method === 'DELETE' && (m = RE_TX_ID.exec(url))) {
    return store.deleteTransaction(m[1]) ? reply(undefined) : fail(404);
  }
  if (method === 'GET' && RE_TX.test(url)) {
    return reply(
      store.getTransactionsPage({
        limit: num(params, 'limit'), offset: num(params, 'offset'), before: str(params, 'before'),
        type: str(params, 'type') as 'income' | 'expense' | undefined, category: str(params, 'category'),
        startDate: str(params, 'startDate'), endDate: str(params, 'endDate'),
        needsReview: flag(params, 'needsReview'), unitemized: flag(params, 'unitemized'), search: str(params, 'search'),
      }),
    );
  }
  if (method === 'POST' && RE_TX.test(url)) return reply(store.createTransaction(req.body as CreateTransactionRequest));

  // ── Cash ───────────────────────────────────────────────────────────
  if (method === 'POST' && (m = RE_CASH_ALLOCATIONS.exec(url))) {
    const body = req.body as CashItemInput;
    const result = store.addCashItem(m[1], body.category, body.amount, body.description);
    return result ? reply(result) : fail(404);
  }
  if (method === 'GET' && (m = RE_CASH_WITHDRAWAL.exec(url))) {
    const result = store.getCashBreakdown(m[1]);
    return result ? reply(result) : fail(404);
  }
  if (method === 'DELETE' && (m = RE_CASH_ALLOCATION_ID.exec(url))) {
    return store.deleteCashItem(m[1]) ? reply(undefined) : fail(404);
  }

  // ── Budget ─────────────────────────────────────────────────────────
  if (method === 'GET' && RE_BUDGET.test(url)) return reply(store.getBudget(num(params, 'month'), num(params, 'year')));
  if (method === 'POST' && RE_BUDGET.test(url)) {
    const body = req.body as SetBudgetRequest;
    store.setBudget(body.category, body.limitAmount, body.month, body.year);
    return reply(undefined);
  }

  // ── Statistics ─────────────────────────────────────────────────────
  if (method === 'GET' && RE_STATS_SUMMARY.test(url)) return reply(store.getStatisticsSummary(num(params, 'month'), num(params, 'year')));
  if (method === 'GET' && RE_STATS_MONTHLY.test(url)) return reply(store.getMonthlyStats());
  if (method === 'GET' && RE_STATS_BY_CATEGORY.test(url)) return reply(store.getCategoryStats(num(params, 'month'), num(params, 'year')));

  // ── Recurring ──────────────────────────────────────────────────────
  if (method === 'GET' && RE_RECURRING.test(url)) return reply(store.getRecurring());
  if (method === 'POST' && RE_RECURRING.test(url)) return reply(store.createRecurring(req.body as CreateRecurringRequest));
  if (method === 'DELETE' && (m = RE_RECURRING_ID.exec(url))) return store.deleteRecurring(m[1]) ? reply(undefined) : fail(404);

  // ── Categories ─────────────────────────────────────────────────────
  if (method === 'GET' && RE_CATEGORY_OVERVIEW.test(url)) return reply(store.getCategoryOverview());
  if (method === 'POST' && (m = RE_CATEGORY_FINISH.exec(url))) {
    const result = store.finishCategoryMove(m[1]);
    return result ? reply(result) : fail(404);
  }
  if (method === 'GET' && RE_CATEGORIES.test(url)) return reply(store.getCategories());
  if (method === 'POST' && RE_CATEGORIES.test(url)) {
    const body = req.body as { name: string; emoji: string; color: string };
    return reply(store.createCategory(body.name, body.emoji, body.color));
  }
  if (method === 'PATCH' && (m = RE_CATEGORY_ID.exec(url))) {
    const result = store.updateCategory(m[1], req.body as CategoryInput);
    return result ? reply(result) : fail(404);
  }
  if (method === 'DELETE' && (m = RE_CATEGORY_ID.exec(url))) {
    const moveTo = str(params, 'moveTo');
    return store.deleteCategory(m[1], moveTo) ? reply(undefined) : fail(409);
  }

  // ── Tips ───────────────────────────────────────────────────────────
  if (method === 'POST' && RE_TIPS_REFRESH.test(url)) return reply(store.refreshTips());
  if (method === 'GET' && RE_TIPS.test(url)) return reply(store.getTips());

  // ── Compare ────────────────────────────────────────────────────────
  if (method === 'GET' && RE_COMPARE_MONTHS.test(url)) return reply(store.getCompareMonths());
  if (method === 'POST' && RE_COMPARE.test(url)) {
    const body = req.body as { monthA: string; monthB: string };
    return reply(store.compare(body.monthA, body.monthB));
  }

  // ── Analytics ──────────────────────────────────────────────────────
  if (method === 'GET' && RE_ANALYTICS_TOP10.test(url)) return reply(store.getTop10());
  if (method === 'GET' && (m = RE_ANALYTICS_CHART.exec(url))) return reply(store.getTransactionChart(decodeURIComponent(m[1])));

  // ── Reports ────────────────────────────────────────────────────────
  if (method === 'POST' && RE_REPORTS_TEST.test(url)) return reply({ ok: true as const });

  // ── Settings ───────────────────────────────────────────────────────
  if (method === 'GET' && RE_SETTINGS.test(url)) return reply(store.getSettings());
  if (method === 'PUT' && RE_SETTINGS_REPORTS.test(url)) return reply(store.saveReportSettings(req.body as ReportsSettingsInput));
  if (method === 'PUT' && RE_SETTINGS_ACCOUNTS.test(url)) return reply(store.saveAccountSettings(req.body as AccountsSettingsInput));
  if (method === 'DELETE' && RE_SETTINGS_REPORTS.test(url)) return reply(store.resetReportSettings());
  if (method === 'DELETE' && RE_SETTINGS_ACCOUNTS.test(url)) return reply(store.resetAccountSettings());

  // ── Ingestion ──────────────────────────────────────────────────────
  if (method === 'GET' && RE_INGESTION_STATUS.test(url)) return reply(store.getIngestionStatus());
  if (method === 'POST' && RE_INGESTION_RUN.test(url)) return reply(store.runIngestion());
  if (method === 'POST' && (m = RE_INGESTION_DISMISS.exec(url))) return store.dismissUnreadable(m[1]) ? reply(undefined) : fail(404);

  // ── Calculator ─────────────────────────────────────────────────────
  if (method === 'GET' && RE_CALC_COMPOUND.test(url)) {
    return reply(
      store.compoundGrowth({
        start: num(params, 'start') ?? 0,
        monthly: num(params, 'monthly') ?? 0,
        rate: num(params, 'rate') ?? 0,
        years: num(params, 'years') ?? 0,
      }),
    );
  }
  if (method === 'GET' && RE_CALC_MINE.test(url)) return reply(store.getMyNumbers());

  // ── Merchants ──────────────────────────────────────────────────────
  if (method === 'GET' && RE_MERCHANTS_MATCH.test(url)) return reply(store.matchMerchant(str(params, 'name') ?? ''));
  if (method === 'GET' && RE_MERCHANTS.test(url)) return reply(store.getMerchants());
  if (method === 'POST' && RE_MERCHANTS.test(url)) {
    const body = req.body as { name: string; category: string };
    return reply(store.addMerchant(body.name, body.category));
  }
  if (method === 'PATCH' && (m = RE_MERCHANT_ID.exec(url))) {
    const body = req.body as { category: string };
    const result = store.changeMerchant(m[1], body.category);
    return result ? reply(result) : fail(404);
  }
  if (method === 'DELETE' && (m = RE_MERCHANT_ID.exec(url))) {
    return store.forgetMerchant(m[1]) ? reply(undefined) : fail(404);
  }

  // eslint-disable-next-line no-console
  console.warn('[preview] unhandled', method, url);
  return fail(404);
};

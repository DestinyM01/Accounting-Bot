# Design Spec: Export, Compare, Analytics
**Date:** 2026-05-26
**Status:** Approved

## Overview

Three new features added to the AccBot web UI and API to bring the web closer to parity with the Telegram bot:

1. **CSV Export** — download filtered transactions as a CSV file
2. **Period Compare** — AI-powered month-vs-month financial comparison (Mistral)
3. **Analytics** — top-10 transaction frequency table + per-transaction history chart

All features follow the existing patterns: NestJS modules on the API, standalone Angular components on the web, JWT-guarded endpoints, dark navy CSS custom properties.

---

## Feature 1: CSV Export

### API

- **Endpoint:** `GET /api/transactions/export`
- **Auth:** JWT-guarded (same as existing `/api/transactions`)
- **Query params:** `startDate`, `endDate`, `category`, `type` — identical to the existing transactions list filters
- **Response:** CSV file with `Content-Type: text/csv` and `Content-Disposition: attachment; filename="transactions-<date>.csv"` headers
- **CSV columns:** `Date, Name, Type, Category, Amount`
- **Implementation:** New `export()` method in `TransactionsService` (or a thin helper in `TransactionsController`) — queries with the same filter logic, maps results to CSV rows using plain string concatenation (no extra library needed). All string fields wrapped in double-quotes to handle commas in transaction names.

### Web

- **Location:** Transactions page toolbar, right side, next to existing filter controls
- **UI:** A single "Export CSV" button with a `download` Material icon
- **Behaviour:** Serializes the current active filter state into query params and triggers a browser download via `window.open(url)` — no Angular HTTP client, no blob handling; the browser handles the file natively
- **No new page, no new nav item**

---

## Feature 2: Period Compare

### API

- **Module:** `compare` (`api/src/compare/`)
- **Endpoints:**
  - `GET /api/compare/months` — returns the distinct `"YYYY-MM"` strings for which the user has at least one transaction, sorted chronologically. Used to populate the month pickers without loading all transaction data.
  - `POST /api/compare`
- **Auth:** JWT-guarded
- **Request body:** `{ monthA: string, monthB: string }` — both in `"YYYY-MM"` format
- **Service logic:**
  1. Query transactions for each month independently using `userId` + date range
  2. Build a `PeriodSummary` for each: `{ month, totalIncome, totalExpenses, net, topCategories: [{category, amount}] }` (top 3 categories by spend)
  3. Call Mistral (`mistral-small-latest`) with both summaries as context — same pattern as `TipsService.callMistral()`
  4. Return `{ monthA: PeriodSummary, monthB: PeriodSummary, analysis: string }`
- **No caching** — inputs vary per request, Mistral call is fresh each time
- **Error:** 400 if either month string is malformed; 404 with message if a month has no transaction data

### Web

- **New page:** `pages/compare/compare.component` — added to router and nav sidebar between Statistics and Recurring
- **Nav label:** "Compare", icon: `compare_arrows`
- **Layout (top to bottom):**
  1. Page header ("Period Compare", subtitle)
  2. Two month-picker `<select>` dropdowns side by side — options populated from `GET /api/compare/months` on page load
  3. "Compare" button — disabled until both months are selected and they differ
  4. Loading skeleton while awaiting response
  5. Two summary cards side by side: income / expenses / net for each month, with income in `--income` green and expenses in `--expense` red
  6. Full-width Mistral analysis panel below the cards — styled like the Tips cards (bordered card, text body)
- **Error state:** shown if either month has no data or the API call fails, with a retry option

### Model

```typescript
export interface PeriodSummary {
  month: string;           // "2026-03"
  totalIncome: number;
  totalExpenses: number;
  net: number;
  topCategories: { category: string; amount: number }[];
}

export interface CompareResult {
  monthA: PeriodSummary;
  monthB: PeriodSummary;
  analysis: string;
}
```

---

## Feature 3: Analytics (Advanced Statistics)

### API

- **Module:** `analytics` (`api/src/analytics/`)
- **Endpoints:**
  - `GET /api/analytics/top10` — aggregates all transactions for `userId` by `transactionName`, returns top 10 by occurrence count: `{ name, count, totalAmount }[]` sorted by `count` descending
  - `GET /api/analytics/chart/:name` — for the given transaction name, returns monthly aggregated totals: `{ month: string, total: number }[]` sorted chronologically (only months with at least one matching transaction)
- **Auth:** Both JWT-guarded
- **Scope:** All-time data (no date filter needed — the value is the long-term trend)

### Web

- **New page:** `pages/analytics/analytics.component` — added to router and nav sidebar after Compare
- **Nav label:** "Analytics", icon: `insights`
- **Layout (two vertical sections):**

**Top 10 Transactions table**
- Columns: rank badge (1–10), transaction name, count, total amount
- Each row is clickable — clicking selects that transaction and loads the chart
- Active row gets a highlight (left border accent or background tint)
- Matches existing table styles from the Recurring page

**Transaction History chart**
- Appears below the table
- Bar chart using Chart.js (already a dependency) showing monthly totals for the selected transaction
- Chart title: the selected transaction name
- If no row is selected: placeholder area with icon + "Select a transaction above to see its history"
- Loading skeleton while chart data is fetching

---

## Shared Implementation Notes

- All new API modules follow the existing pattern: `module.ts` registers schema + controller + service, imported in `app.module.ts`
- All new Angular components are standalone, import `CommonModule`, `MatIconModule`, `CurrencyPipe` as needed
- CSS uses existing custom properties only (`--bg-card`, `--border`, `--income`, `--expense`, `--accent`, `--text`, `--text-muted`, `--radius`) — no new variables
- Nav items added in `app.component.ts` `navItems` array
- Routes added in `app.routes.ts` with lazy loading (matching existing pattern)
- Karpathy guidelines apply throughout: no speculative features, surgical changes only, verify build compiles before committing

---

## Out of Scope

- Financial literacy content (static, low value for web)
- Family/group budgets (multi-user session management, significant scope)
- Premium/subscription gating (not applicable for self-hosted personal app)
- Editing or deleting transactions from the web (bot is the data-entry surface)

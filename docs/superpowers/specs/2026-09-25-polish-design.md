# Polish (Group 3) — Design Spec

**Goal:** Every chart follows the theme and shows its tooltip on hover anywhere in a column. The Budget page's "Create Category" card works. The Recurring page's "Billed this month" shows the right bills on their due days. The README stops quoting test counts that go stale.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Which charts | **All four pages** with hard-coded colours: Dashboard, Statistics, Analytics and Recurring. Balance moves onto the same helper. |
| How | **A small shared helper** that reads the theme tokens when a chart is built. No Chart.js global defaults. |
| Billed this month | **Derived from `lastPeriod`**, the month the scheduler last handled, and dated on the due day. |

## 1. Chart theme helper

New `web/src/app/core/ui/chart-theme.ts`:
- **`chartTheme()`** returns `{ text, muted, grid, card, accent, income, expense }`. It reads `--text`, `--text-muted`, `--border`, `--bg-card`, `--accent`, `--income` and `--expense` with `getComputedStyle(document.documentElement)`.
- **`withAlpha(color, alpha)`** makes a colour see-through:
  - `oklch(L C H)` becomes `oklch(L C H / alpha)`;
  - `#rrggbb` becomes `rgba(r, g, b, alpha)`;
  - any other value comes back unchanged.
- **`tooltipStyle(t)`** returns `{ backgroundColor: t.card, borderColor: t.grid, borderWidth: 1, titleColor: t.muted, bodyColor: t.text }`.
- **`axisStyle(t)`** returns `{ grid: { color: t.grid }, ticks: { color: t.muted, font: { size: 11 } } }`.
- **`HOVER_COLUMN`** is `{ mode: 'index', intersect: false }`, for charts where hovering anywhere over a column shows its tooltip.

## 2. Charts

| Page | Chart | Change |
|---|---|---|
| Dashboard | Income/expense lines | Lines use `t.income` and `t.expense`. Fills are gradients from `withAlpha(…, 0.25 / 0.15)` down to `withAlpha(…, 0)`. Tooltip and axes come from the helper; `interaction: HOVER_COLUMN`. |
| Statistics | Income/expense area | As Dashboard, with fill alphas 0.28 and 0.18. |
| Statistics | Savings bars | The last bar is `t.income`, the others `withAlpha(t.income, 0.35)`. The tooltip stays off. |
| Analytics | Monthly history bars | Same bar colours. Tooltip and axes from the helper; `interaction: HOVER_COLUMN`. |
| Recurring | Money-flow (sankey) | The hub node is `t.accent`, Savings is `t.income`, the fallback node colour is `t.muted`. Tooltip from the helper. Hover stays per flow. |
| Balance | Daily balance | Its own token reads are replaced with `chartTheme()`, `axisStyle` and `HOVER_COLUMN`. It looks the same. |

**Category colours:**
- **Dashboard.** Its `categoryColor` map is removed; it uses `CategoryService.color`, so custom categories get their own colour instead of grey.
- **Recurring.** Its flow nodes already use `CategoryService.color`.

**Check:** after the change, the chart code of these five components holds no `#hex`, `rgb(` or `rgba(` literal.

## 3. Budget "Create Category" card

The placeholder card becomes `<a routerLink="/categories">`:
- it keeps its classes and look;
- it gets a `:focus-visible` outline in `--color-focus`;
- its `aria-label` is "Create a category on the Categories page".

`BudgetComponent` imports `RouterLink`.

## 4. Recurring "Billed this month"

- **Api.** `RecurringService.list()` also returns `lastPeriod: string | null`.
- **Web.**
  - `RecurringEntry` gains `lastPeriod?: string | null`.
  - A rule is billed this month when its `lastPeriod` equals the current month (`'YYYY-MM'`, browser-local time). A legacy rule without `lastPeriod` falls back to the month of `lastExecutedAt`, as the scheduler does.
  - The date shown is the due day in the current month, `{Mon} {dayOfMonth}` (for example "Sep 20"), not the booking time.

Rules skipped as too old also set `lastPeriod`, but only for months more than 31 days back, so they never count as billed this month.

## 5. README

In the Testing section, the counts ("22 unit tests across 3 suites" and the per-file numbers) are replaced with a count-free summary:
- the api Jest suite, what its tests cover and `pnpm test`;
- the web app's verification by a clean `ng build`.

## Testing

- **Api:** `recurring.service.spec.ts` checks that `list()` returns `lastPeriod` (null when missing).
- **Web:**
  - a clean `ng build`;
  - `grep` finds no colour literals in the chart code of the five components;
  - preview-harness screenshots with fake data: Dashboard, Statistics, Analytics, Recurring (flow chart and billed list) and the Budget link;
  - a column tooltip shown by hovering between points.

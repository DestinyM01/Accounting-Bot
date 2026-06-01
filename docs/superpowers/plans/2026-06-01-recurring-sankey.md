# Recurring Cash-Flow Sankey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sankey "cash-flow overview" panel to the web Recurring page, showing fixed income flowing through a monthly hub to expense items and a savings surplus.

**Architecture:** Uses `chartjs-chart-sankey` (a Chart.js 4 plugin — matches the existing Chart.js stack on dashboard/statistics/analytics). The panel sits between the existing summary cards and the items table. Node colors come from the shared `CategoryService` (built in the custom-categories work), so built-in and custom categories color consistently. The recurring component is also migrated off its local duplicated color/icon maps onto `CategoryService` (the 5th duplicate the earlier consolidation missed) — this fixes a color divergence and gives the existing list custom-category color support, with zero template changes (method names preserved).

**Tech Stack:** Angular 17 standalone components · Chart.js 4 + chartjs-chart-sankey · CategoryService · pnpm (run from `web/`)

**Design decisions (locked):**
- **Node model (namespaced keys to stay acyclic):** each income item → `in:<name>` node → `hub` ("Monthly Income") → each expense item `out:<name>` node, plus `hub` → `sav` ("Savings") when there's a surplus. Keys are prefixed so an income and an expense with the same name never collide into a cycle; `labels` render the clean titlecased name.
- **Colors:** income/expense nodes use `categoryColor(item.category)` (→ CategoryService); `hub` is teal `#14b8a6`; `sav` is green `#34d399`.
- **Render guard:** panel only shows when there is ≥1 income AND ≥1 expense item (otherwise the flow story is incomplete and the summary cards already convey the totals).
- **Surplus node:** only added when `totalIncome - totalExpense > 0`.
- **Mobile:** panel hidden below 700px via CSS; the existing summary cards carry the numbers there. Chart uses `responsive: true` so it redraws if the container becomes visible on resize.
- **Lifecycle:** mirrors the dashboard pattern — `@ViewChild` canvas, build via `setTimeout(() => this.buildFlowChart(), 0)` in the `load()` success callback (so the canvas exists once `loading=false`), destroy the prior chart on rebuild and in `ngOnDestroy`.

---

## File map

| File | Task | Change |
|---|---|---|
| `web/package.json` | 1 | Add `chartjs-chart-sankey` dependency |
| `web/src/app/pages/recurring/recurring.component.ts` | 2 | Replace local CATEGORY_COLORS/ICONS with CategoryService delegation (method names unchanged) |
| `web/src/app/pages/recurring/recurring.component.ts` | 3 | Sankey: imports, ViewChild, buildFlowChart, showFlowChart, lifecycle |
| `web/src/app/pages/recurring/recurring.component.html` | 3 | Add the flow panel `<canvas>` with guard |
| `web/src/app/pages/recurring/recurring.component.scss` | 3 | Panel styling + mobile hide |

---

## Task 1 — Add the `chartjs-chart-sankey` dependency

**Files:**
- Modify: `web/package.json` (via pnpm)

- [ ] **Step 1: Install the plugin**

  ```bash
  cd web && pnpm add chartjs-chart-sankey
  ```
  This adds `chartjs-chart-sankey` (Chart.js 4 compatible) to `dependencies`.

- [ ] **Step 2: Verify it resolves and the app still builds**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.` — no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add web/package.json web/pnpm-lock.yaml
  git commit -m "build(web): add chartjs-chart-sankey dependency"
  ```

---

## Task 2 — Migrate recurring component to CategoryService (DRY + custom-category colors)

**Files:**
- Modify: `web/src/app/pages/recurring/recurring.component.ts`

**Context:** The component currently defines local `CATEGORY_ICONS` and `CATEGORY_COLORS` maps (lines 7–27) and exposes `categoryIcon(cat)` / `categoryColor(cat)` (lines 107–108). The values diverge from the canonical `CategoryService` set, and the local maps have no entries for custom categories (they'd fall back to gray). Migrating to `CategoryService` fixes both. The method NAMES stay `categoryColor` / `categoryIcon` so the HTML template needs no changes.

- [ ] **Step 1: Delete the two local constant blocks**

  Remove lines 7–27 (the `const CATEGORY_ICONS = {...}` and `const CATEGORY_COLORS = {...}` blocks).

- [ ] **Step 2: Import CategoryService**

  Add after the existing imports at the top:
  ```typescript
  import { CategoryService } from '../../core/services/category.service';
  ```

- [ ] **Step 3: Inject CategoryService in the constructor**

  Change:
  ```typescript
    constructor(private api: ApiService) {}
  ```
  to:
  ```typescript
    constructor(private api: ApiService, private catSvc: CategoryService) {}
  ```

- [ ] **Step 4: Replace the helper method bodies (keep the names)**

  Change:
  ```typescript
    categoryIcon(cat: string): string  { return CATEGORY_ICONS[cat]  ?? CATEGORY_ICONS['other'];  }
    categoryColor(cat: string): string { return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS['other']; }
  ```
  to:
  ```typescript
    categoryIcon(cat: string): string  { return this.catSvc.icon(cat);  }
    categoryColor(cat: string): string { return this.catSvc.color(cat); }
  ```

- [ ] **Step 5: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.` — no errors. (The HTML still calls `categoryColor`/`categoryIcon`, which now delegate to the service.)

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/app/pages/recurring/recurring.component.ts
  git commit -m "refactor(web/recurring): use CategoryService for category colors/icons"
  ```

---

## Task 3 — Add the Sankey cash-flow panel

**Files:**
- Modify: `web/src/app/pages/recurring/recurring.component.ts`
- Modify: `web/src/app/pages/recurring/recurring.component.html`
- Modify: `web/src/app/pages/recurring/recurring.component.scss`

**Context:** After Task 2, the component injects `CategoryService` and exposes `categoryColor()`. Now add the chart. Follow the dashboard's lifecycle pattern (`@ViewChild` + `setTimeout(...,0)` after data load).

- [ ] **Step 1: Update imports and class declaration in `recurring.component.ts`**

  Change the Angular import line:
  ```typescript
  import { Component, OnInit } from '@angular/core';
  ```
  to:
  ```typescript
  import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
  ```

  Add Chart.js + sankey imports after the existing imports:
  ```typescript
  import { Chart, registerables } from 'chart.js';
  import { SankeyController, Flow } from 'chartjs-chart-sankey';

  Chart.register(...registerables, SankeyController, Flow);
  ```

  Change the class declaration:
  ```typescript
  export class RecurringComponent implements OnInit {
  ```
  to:
  ```typescript
  export class RecurringComponent implements OnInit, OnDestroy {
  ```

- [ ] **Step 2: Add the ViewChild, chart field, and a titlecase helper to the class**

  Add these as the first members of the class (after `error = '';`):
  ```typescript
    @ViewChild('flowCanvas') flowCanvas?: ElementRef<HTMLCanvasElement>;
    private flowChart: Chart | null = null;

    private readonly HUB = 'hub';
    private readonly SAV = 'sav';
    private readonly HUB_COLOR = '#14b8a6';
    private readonly SAV_COLOR = '#34d399';
  ```

- [ ] **Step 3: Add the `showFlowChart` getter**

  Add near the other getters:
  ```typescript
    /** Only show the flow chart when there's both income and expense to connect. */
    get showFlowChart(): boolean {
      const hasIncome  = this.items.some(r => r.isIncome);
      const hasExpense = this.items.some(r => !r.isIncome);
      return hasIncome && hasExpense;
    }
  ```

- [ ] **Step 4: Trigger the chart build after data loads**

  In `load()`, update the `next` handler to build the chart after the view settles:
  ```typescript
    load() {
      this.loading = true;
      this.error = '';
      this.api.getRecurring().subscribe({
        next: (data) => {
          this.items = data;
          this.loading = false;
          setTimeout(() => this.buildFlowChart(), 0);
        },
        error: () => { this.error = 'Failed to load recurring transactions.'; this.loading = false; },
      });
    }
  ```

- [ ] **Step 5: Add `buildFlowChart()` and `ngOnDestroy()`**

  Add these methods to the class (e.g. after `load()`):
  ```typescript
    private titleCase(s: string): string {
      return s.replace(/\b\w/g, c => c.toUpperCase());
    }

    buildFlowChart() {
      // Tear down any previous instance (rebuild on reload)
      if (this.flowChart) { this.flowChart.destroy(); this.flowChart = null; }

      if (!this.showFlowChart) return;
      const canvas = this.flowCanvas?.nativeElement;
      if (!canvas) return;

      const income  = this.items.filter(r => r.isIncome);
      const expense = this.items.filter(r => !r.isIncome);
      const totalIncome  = income.reduce((s, r) => s + r.amount, 0);
      const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
      const surplus = totalIncome - totalExpense;

      const data: { from: string; to: string; flow: number }[] = [];
      const labels: Record<string, string> = { [this.HUB]: 'Monthly Income', [this.SAV]: 'Savings' };
      const colors: Record<string, string> = { [this.HUB]: this.HUB_COLOR, [this.SAV]: this.SAV_COLOR };

      income.forEach(r => {
        const key = `in:${r.id}`;
        data.push({ from: key, to: this.HUB, flow: r.amount });
        labels[key] = this.titleCase(r.transactionName);
        colors[key] = this.categoryColor(r.category);
      });
      expense.forEach(r => {
        const key = `out:${r.id}`;
        data.push({ from: this.HUB, to: key, flow: r.amount });
        labels[key] = this.titleCase(r.transactionName);
        colors[key] = this.categoryColor(r.category);
      });
      if (surplus > 0) {
        data.push({ from: this.HUB, to: this.SAV, flow: surplus });
      }

      const nodeColor = (name: string) => colors[name] ?? '#94a3b8';

      this.flowChart = new Chart(canvas, {
        type: 'sankey',
        data: {
          datasets: [{
            data,
            labels,
            colorFrom: (c: any) => nodeColor(c.dataset.data[c.dataIndex].from),
            colorTo:   (c: any) => nodeColor(c.dataset.data[c.dataIndex].to),
            colorMode: 'gradient',
            borderWidth: 0,
            nodeWidth: 14,
            nodePadding: 14,
          } as any],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0e1726',
              borderColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              titleColor: '#94a3b8',
              bodyColor: '#e2e8f0',
              callbacks: {
                label: (ctx: any) => {
                  const d = ctx.dataset.data[ctx.dataIndex];
                  const from = labels[d.from] ?? d.from;
                  const to   = labels[d.to]   ?? d.to;
                  return `${from} → ${to}: ${d.flow.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
                },
              },
            },
          },
        },
      });
    }

    ngOnDestroy() {
      if (this.flowChart) { this.flowChart.destroy(); this.flowChart = null; }
    }
  ```

- [ ] **Step 6: Update `deleteItem()` to rebuild the chart after a delete**

  The delete removes an item locally; rebuild the flow so the chart stays in sync:
  ```typescript
    deleteItem(item: RecurringEntry) {
      if (!window.confirm(`Delete "${item.transactionName}"? This cannot be undone.`)) return;
      this.api.deleteRecurring(item.id).subscribe({
        next: () => {
          this.items = this.items.filter(r => r.id !== item.id);
          setTimeout(() => this.buildFlowChart(), 0);
        },
        error: () => { alert('Failed to delete. Please try again.'); },
      });
    }
  ```

- [ ] **Step 7: Add the panel to `recurring.component.html`**

  Find the summary-cards block (the `<div class="summary-row">` containing the income/expense cards) inside the `@if (!loading && !error)` block. Immediately AFTER its closing `</div>` (the end of `.summary-row`), insert:
  ```html
    @if (showFlowChart) {
      <div class="card rp-flow-panel">
        <div class="rp-flow-head">
          <span class="rp-flow-title">Cash-flow overview</span>
          <span class="rp-flow-sub">band width = monthly amount</span>
        </div>
        <div class="rp-flow-canvas-wrap">
          <canvas #flowCanvas></canvas>
        </div>
      </div>
    }
  ```

- [ ] **Step 8: Add panel styles to `recurring.component.scss`**

  Append at the end of the file:
  ```scss
  // ── Cash-flow Sankey panel ─────────────────────────────────────────────
  .rp-flow-panel {
    margin-bottom: 16px;
    padding: 18px 16px 12px;
  }

  .rp-flow-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6px;
    padding: 0 4px;
  }
  .rp-flow-title { font-size: 1rem; font-weight: 600; color: var(--text); }
  .rp-flow-sub   { font-size: 0.75rem; color: var(--text-muted); }

  .rp-flow-canvas-wrap {
    position: relative;
    height: 320px;
    width: 100%;
  }

  // Sankey is unreadable on narrow screens — the summary cards above carry
  // the key numbers on mobile.
  @media (max-width: 700px) {
    .rp-flow-panel { display: none; }
  }
  ```

- [ ] **Step 9: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -8
  ```
  Expected: `Application bundle generation complete.` — no errors.

- [ ] **Step 10: Commit**

  ```bash
  git add web/src/app/pages/recurring/recurring.component.ts \
          web/src/app/pages/recurring/recurring.component.html \
          web/src/app/pages/recurring/recurring.component.scss
  git commit -m "feat(web/recurring): add cash-flow Sankey overview panel"
  ```

---

## Self-review

**Spec coverage:**

| Decision | Task | Closed by |
|---|---|---|
| chartjs-chart-sankey on the Chart.js 4 stack | 1 | `pnpm add chartjs-chart-sankey` |
| Node colors from CategoryService (incl. custom) | 2 + 3 | recurring migrated to CategoryService; `categoryColor()` used for nodes |
| Namespaced acyclic node keys (`in:`/`out:`/hub/sav) | 3 | `buildFlowChart()` data assembly |
| Render guard (income AND expense present) | 3 | `showFlowChart` getter + `@if` |
| Surplus node only when positive | 3 | `if (surplus > 0)` |
| Mobile hidden, summary cards as fallback | 3 | `@media (max-width:700px){ display:none }` |
| Dashboard-style lifecycle | 3 | `@ViewChild` + `setTimeout(...,0)` + `ngOnDestroy` destroy |
| Chart stays in sync after delete | 3 | `deleteItem` rebuilds |

**Placeholder scan:** No TBDs. All code blocks complete. ✓

**Type consistency:**
- `categoryColor(cat: string): string` defined in Task 2, called in Task 3's `buildFlowChart`. ✓
- `flowCanvas` ViewChild name matches `#flowCanvas` in the HTML (Task 3). ✓
- `showFlowChart` getter (Task 3) matches the `@if (showFlowChart)` in the HTML (Task 3). ✓
- `RecurringEntry` fields used (`id`, `isIncome`, `amount`, `category`, `transactionName`) all exist in the model. ✓

**Risk note:** The `colorFrom`/`colorTo` callback context shape (`c.dataset.data[c.dataIndex]`) is the documented chartjs-chart-sankey accessor. If the installed plugin version exposes the datum differently, the implementer should consult the plugin's types and adjust the accessor (the datum has `from`, `to`, `flow`). Cast to `any` is already used to avoid type friction with the plugin's dataset shape.

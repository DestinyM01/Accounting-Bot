# Hallmark Audit Fixes — Post-Redesign Pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Karpathy discipline (mandatory for every task):**
> - State assumptions before touching code
> - Simplicity first — minimum change that closes the finding
> - Surgical — every changed line must trace to a named finding
> - Verify with `pnpm run build` after each task; zero new errors is the pass bar

**Goal:** Close all 14 Hallmark audit findings (1 critical, 7 major, 6 minor) identified in the post-redesign audit by making surgical in-place CSS edits — no new components, no restructuring.

**Architecture:** Seven tasks in dependency order. Task 1 adds 4 new design tokens that Tasks 2–6 reference by name. Tasks 2–6 are independent per-file fixes. Task 7 stamps all page components. No HTML changes except Task 4 (4 template files where the `prog-fill` width binding moves to `transform`).

**Tech Stack:** Angular 17 SCSS · CSS custom properties (OKLCH) · pnpm (run commands from `web/` directory)

---

## File map

| File | Task | What changes |
|---|---|---|
| `web/src/tokens.css` | 1 | +4 new tokens |
| `web/src/app/app.component.scss` | 2 | `#111e30`, `#fb923c`, 9× white-overlay rgba → tokens |
| `web/src/app/pages/statistics/statistics.component.scss` | 3 | `#fb923c`, `rgba(251,146,60,0.15)` → tokens |
| `web/src/app/pages/dashboard/dashboard.component.scss` | 3 | Cut glow shadow |
| `web/src/styles.scss` | 4 | Progress bar transition + semantic tint rgba → tokens |
| `web/src/app/pages/dashboard/dashboard.component.html` | 4 | `[style.width.%]` → `[style.transform]` |
| `web/src/app/pages/statistics/statistics.component.html` | 4 | `[style.width.%]` → `[style.transform]` |
| `web/src/app/pages/budget/budget.component.html` | 4 | `[style.width.%]` → `[style.transform]` (×2) |
| `web/src/app/pages/analytics/analytics.component.scss` | 5 | Remove side-stripe, tokenize active background |
| `web/src/app/pages/tips/tips.component.scss` | 6 | Off-palette blue → accent-subtle |
| `web/src/app/pages/budget/budget.component.scss` | 6 | Cut decorative gradient |
| `web/src/app/pages/recurring/recurring.component.scss` | 6 | Accent-surface colors + icon tints → tokens |
| 8× `*.component.scss` page files | 7 | Add Hallmark system stamp |

---

## Task 1 — Expand `tokens.css` with 4 missing tokens

**Files:**
- Modify: `web/src/tokens.css` (legacy-aliases block, lines 70–83)

**Findings closed:** minor #12 (12% semantic tints), minor #13 (accent-ink-muted), minor #15 (surface-hover), enabling Tasks 2–6.

- [ ] **Step 1: Add the 4 tokens to the legacy-aliases block in `tokens.css`**

  Open `web/src/tokens.css`. After the line `--sidebar-w: 240px;` (last line inside `:root`), add:

  ```css
  /* ── Hallmark audit additions 2026-05-27 ──────────────────────────────── */
  --color-surface-hover:    oklch(100%  0     0 / 6%);   /* white overlay — hover/track surfaces   */
  --color-income-subtle-2:  oklch(81%   0.18  168 / 12%);/* income tint at 12% — icon backgrounds  */
  --color-expense-subtle-2: oklch(72%   0.18   25 / 12%);/* expense tint at 12% — icon backgrounds */
  --color-accent-ink-muted: oklch(98%   0.01  200 / 65%);/* subdued text on accent surface          */
  ```

  The block after the edit should end:

  ```css
    --sidebar-w:   240px;
    /* ── Hallmark audit additions 2026-05-27 ──────────────────────────────── */
    --color-surface-hover:    oklch(100%  0     0 / 6%);
    --color-income-subtle-2:  oklch(81%   0.18  168 / 12%);
    --color-expense-subtle-2: oklch(72%   0.18   25 / 12%);
    --color-accent-ink-muted: oklch(98%   0.01  200 / 65%);
  }
  ```

- [ ] **Step 2: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.` — no new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/tokens.css
  git commit -m "fix(tokens): add 4 missing design tokens for audit fixes"
  ```

---

## Task 2 — `app.component.scss`: fix 3 raw-value violations

**Files:**
- Modify: `web/src/app/app.component.scss`

**Findings closed:** major #1 (`#111e30`), major #2 (`#fb923c` in shell), minor #15 (white-overlay hover surfaces throughout the shell)

**Assumptions:**
- `--color-surface-hover` is `oklch(100% 0 0 / 6%)`. The current hover backgrounds range from 5–7% opacity. Unifying to 6% via the token is perceptually equivalent (1% delta is imperceptible on dark surfaces).
- `--color-paper-2` is the correct token for the dropdown panel background (`#111e30` ≈ `oklch(16% 0.04 230)`).

- [ ] **Step 1: Fix `#111e30` → `var(--color-paper-2)` (line 260)**

  Find:
  ```scss
  .dropdown-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: #111e30;
  ```
  Replace `background: #111e30;` with `background: var(--color-paper-2);`.

- [ ] **Step 2: Fix `#fb923c` → `var(--color-warning)` in `.notif-icon` (line 327)**

  Find:
  ```scss
  .notif-icon {
    flex-shrink: 0;
    margin-top: 2px;
    mat-icon { font-size: 20px; width: 20px; height: 20px; color: #fb923c; }
  }
  ```
  Replace `color: #fb923c` with `color: var(--color-warning)`.

- [ ] **Step 3: Replace all white-overlay rgba values with `var(--color-surface-hover)`**

  There are 9 occurrences across 5 selectors. Apply all at once using find-replace. The values to replace and their locations:

  | Line | Selector | Old value | New value |
  |---|---|---|---|
  | 68 | `.collapse-btn:hover` | `rgba(255,255,255,0.07)` | `var(--color-surface-hover)` |
  | 70 | `.collapse-btn:focus-visible` | `rgba(255,255,255,0.07)` | `var(--color-surface-hover)` |
  | 107 | `.nav-item:hover` | `rgba(255,255,255,0.05)` | `var(--color-surface-hover)` |
  | 109 | `.nav-item:focus-visible` | `rgba(255,255,255,0.05)` | `var(--color-surface-hover)` |
  | 221 | `.icon-btn:hover, &.active` | `rgba(255,255,255,0.06)` | `var(--color-surface-hover)` |
  | 223 | `.icon-btn:focus-visible` | `rgba(255,255,255,0.06)` | `var(--color-surface-hover)` |
  | 336 | `.notif-bar` (track bg) | `rgba(255,255,255,0.06)` | `var(--color-surface-hover)` |
  | 376 | `.settings-item:hover` | `rgba(255,255,255,0.05)` | `var(--color-surface-hover)` |
  | 378 | `.settings-item:focus-visible` | `rgba(255,255,255,0.05)` | `var(--color-surface-hover)` |
  | 407 | `.hamburger-btn:hover, :focus-visible` | `rgba(255,255,255,0.06)` | `var(--color-surface-hover)` |

  After editing, grep to confirm no raw white overlays remain in this file:
  ```bash
  grep -n "rgba(255,255,255" web/src/app/app.component.scss
  ```
  Expected: no output (zero matches).

- [ ] **Step 4: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.` — no new errors.

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/app/app.component.scss
  git commit -m "fix(shell): replace raw hex/rgba with design tokens in app.component.scss"
  ```

---

## Task 3 — `statistics.component.scss` + `dashboard.component.scss`: warning tokens + glow shadow

**Files:**
- Modify: `web/src/app/pages/statistics/statistics.component.scss`
- Modify: `web/src/app/pages/dashboard/dashboard.component.scss`

**Findings closed:** major #3 (`#fb923c` in statistics), major #4 (`rgba(251,146,60,0.15)` warning tint), major #5 (glow shadow on dark)

**Assumption:** `--color-warning-subtle` is `oklch(77% 0.17 80 / 8%)`. The `.near-limit-badge` currently uses 15% opacity. Using 8% is a perceptible difference; if stronger emphasis is needed, the plan owner may add `--color-warning-subtle-2: oklch(77% 0.17 80 / 15%)` to tokens.css first. For now, use the existing `--color-warning-subtle`.

- [ ] **Step 1: Fix `.near-limit-badge` in `statistics.component.scss` (lines 150–157)**

  Find:
  ```scss
  .near-limit-badge {
    font-size: 0.72rem;
    background: rgba(251,146,60,0.15);
    color: #fb923c;
    padding: 3px 9px;
    border-radius: 20px;
    font-weight: 600;
  }
  ```
  Replace with:
  ```scss
  .near-limit-badge {
    font-size: 0.72rem;
    background: var(--color-warning-subtle);
    color: var(--color-warning);
    padding: 3px 9px;
    border-radius: 20px;
    font-weight: 600;
  }
  ```

- [ ] **Step 2: Cut `.live-dot` glow shadow in `dashboard.component.scss` (line 33)**

  Find:
  ```scss
  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--income);
    box-shadow: 0 0 6px var(--income);
    animation: pulse 2s infinite;
  }
  ```
  Replace with:
  ```scss
  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--income);
    animation: pulse 2s infinite;
  }
  ```
  (Remove only the `box-shadow` line — no other changes.)

- [ ] **Step 3: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/app/pages/statistics/statistics.component.scss \
           web/src/app/pages/dashboard/dashboard.component.scss
  git commit -m "fix(statistics,dashboard): tokenize warning colors, cut glow shadow"
  ```

---

## Task 4 — `styles.scss` + 4 HTML templates: progress bar transition + semantic tints

**Files:**
- Modify: `web/src/styles.scss`
- Modify: `web/src/app/pages/dashboard/dashboard.component.html` (line 62)
- Modify: `web/src/app/pages/statistics/statistics.component.html` (line 62)
- Modify: `web/src/app/pages/budget/budget.component.html` (lines 37, 103)

**Findings closed:** major #6 (layout-property transition + raw easing), minor #12 (stat-badge/tx-icon semantic tints)

**Assumption on progress bar approach:** `.prog-fill` switches from `width`-based to `transform: scaleX()`-based animation. `width: 100%` is set permanently; the CSS transition fires on `transform` only. Templates that currently use `[style.width.%]="value"` will use `[style.transform]="'scaleX(' + value / 100 + ')'"`. The `border-radius` clipping at the right end is hidden by `.prog-bar { overflow: hidden }`.

**Assumption on duration:** `--dur-base` (220ms) replaces the raw `0.4s` (400ms). The shorter duration matches the design system; fill animations will be noticeably snappier.

- [ ] **Step 1: Update `.prog-fill` in `styles.scss` (lines 198–208)**

  Find:
  ```scss
  .prog-bar {
    height: 5px;
    border-radius: 3px;
    background: rgba(255,255,255,0.06);
    overflow: hidden;
    .prog-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }
  }
  ```
  Replace with:
  ```scss
  .prog-bar {
    height: 5px;
    border-radius: 3px;
    background: var(--color-surface-hover);
    overflow: hidden;
    .prog-fill {
      height: 100%;
      width: 100%;
      border-radius: 3px;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform var(--dur-base) var(--ease-out);
    }
  }
  ```
  Changes: track bg tokenized, `width` binding removed from CSS, `transform`-based animation added.

- [ ] **Step 2: Tokenize `.stat-badge` backgrounds in `styles.scss` (lines 94–96)**

  Find:
  ```scss
  .stat-badge {
    ...
    &.up   { background: rgba(16,229,160,0.12); color: var(--income); }
    &.down { background: rgba(248,113,113,0.12); color: var(--expense); }
    &.neutral { background: rgba(100,116,139,0.15); color: var(--text-muted); }
  }
  ```
  Replace only the `.up` and `.down` lines (leave `.neutral` untouched — no token for slate):
  ```scss
    &.up   { background: var(--color-income-subtle-2); color: var(--income); }
    &.down { background: var(--color-expense-subtle-2); color: var(--expense); }
  ```

- [ ] **Step 3: Tokenize `.tx-icon` backgrounds in `styles.scss` (lines 160–161)**

  Find:
  ```scss
  .tx-icon {
    ...
    &.income-icon  { background: rgba(16,229,160,0.12); color: var(--income); }
    &.expense-icon { background: rgba(248,113,113,0.12); color: var(--expense); }
  }
  ```
  Replace:
  ```scss
    &.income-icon  { background: var(--color-income-subtle-2); color: var(--income); }
    &.expense-icon { background: var(--color-expense-subtle-2); color: var(--expense); }
  ```

- [ ] **Step 4: Update `dashboard.component.html` line 62 — `[style.width.%]` → `[style.transform]`**

  Find (lines 61–64):
  ```html
  <div class="prog-fill"
       [style.width.%]="b.percentage"
       [style.background]="categoryColor(b.category)">
  </div>
  ```
  Replace with:
  ```html
  <div class="prog-fill"
       [style.transform]="'scaleX(' + b.percentage / 100 + ')'"
       [style.background]="categoryColor(b.category)">
  </div>
  ```

- [ ] **Step 5: Update `statistics.component.html` line 62**

  Find:
  ```html
  <div class="prog-fill" [style.width.%]="row.pct" [style.background]="row.color"></div>
  ```
  Replace with:
  ```html
  <div class="prog-fill" [style.transform]="'scaleX(' + row.pct / 100 + ')'" [style.background]="row.color"></div>
  ```

- [ ] **Step 6: Update `budget.component.html` line 37 (hero progress bar)**

  Find:
  ```html
  <div class="prog-fill" [style.width.%]="totalPct" [style.background]="budgetBarColor(totalPct)"></div>
  ```
  Replace with:
  ```html
  <div class="prog-fill" [style.transform]="'scaleX(' + totalPct / 100 + ')'" [style.background]="budgetBarColor(totalPct)"></div>
  ```

- [ ] **Step 7: Update `budget.component.html` lines 102–105 (per-category budget bar)**

  Find:
  ```html
  <div class="prog-fill"
       [style.width.%]="b.percentage"
       [style.background]="budgetBarColor(b.percentage)">
  </div>
  ```
  Replace with:
  ```html
  <div class="prog-fill"
       [style.transform]="'scaleX(' + b.percentage / 100 + ')'"
       [style.background]="budgetBarColor(b.percentage)">
  </div>
  ```

- [ ] **Step 8: Verify no `[style.width.%]` remains on prog-fill**

  ```bash
  grep -rn "prog-fill" web/src/app --include="*.html"
  ```
  Expected: 4 lines, none containing `style.width`.

- [ ] **Step 9: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.` — no new errors.

- [ ] **Step 10: Commit**

  ```bash
  git add web/src/styles.scss \
           web/src/app/pages/dashboard/dashboard.component.html \
           web/src/app/pages/statistics/statistics.component.html \
           web/src/app/pages/budget/budget.component.html
  git commit -m "fix(styles): transform-based progress bars, tokenize semantic tints"
  ```

---

## Task 5 — `analytics.component.scss`: remove side-stripe (critical)

**Files:**
- Modify: `web/src/app/pages/analytics/analytics.component.scss`

**Findings closed:** critical #1 (side-stripe card), minor #8 (`rgba(16,229,160,0.06)` inline on active row)

- [ ] **Step 1: Replace `.table-row.active` block (lines 60–65)**

  Find:
  ```scss
  &.active {
    background:   rgba(16,229,160,0.06);
    border-left:  3px solid var(--income);
    padding-left: 21px;
  }
  ```
  Replace with:
  ```scss
  &.active {
    background: var(--color-income-subtle);
  }
  ```
  Removes the side-stripe border and compensating padding; tokenizes the background.

- [ ] **Step 2: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/app/pages/analytics/analytics.component.scss
  git commit -m "fix(analytics): remove side-stripe anti-pattern from active table row"
  ```

---

## Task 6 — `tips`, `budget`, `recurring`: palette drift + accent-surface colors

**Files:**
- Modify: `web/src/app/pages/tips/tips.component.scss`
- Modify: `web/src/app/pages/budget/budget.component.scss`
- Modify: `web/src/app/pages/recurring/recurring.component.scss`

**Findings closed:** major #7 (off-palette blue in tips), minor #11 (gradient in budget), minor #9 (`#fff` on accent in recurring), minor #10 (`rgba(255,255,255,0.65)` on accent in recurring), minor #14 (12% tints in recurring)

- [ ] **Step 1: Fix off-palette blue in `tips.component.scss` (line 117)**

  Find:
  ```scss
  .tip-icon-wrap {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(59,130,246,0.12);
  ```
  Replace `background: rgba(59,130,246,0.12)` with `background: var(--color-accent-subtle)`.

- [ ] **Step 2: Cut decorative gradient in `budget.component.scss` (lines 44–48)**

  Find:
  ```scss
  .hero-bg-chart {
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 160px;
    opacity: 0.06;
    background: linear-gradient(90deg, transparent, var(--accent));
  }
  ```
  Replace `background: linear-gradient(90deg, transparent, var(--accent));` with `background: var(--color-accent-subtle);`.
  Also remove `opacity: 0.06;` (the token's built-in 18% opacity is the correct emphasis at full opacity).

  After edit, the block reads:
  ```scss
  .hero-bg-chart {
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 160px;
    background: var(--color-accent-subtle);
  }
  ```

- [ ] **Step 3: Fix accent-surface text colors in `recurring.component.scss`**

  Fix `.date-day` (line 335) — text on accent-colored date card:
  ```scss
  // Before:
  .date-day {
    font-size: 1.75rem;
    font-weight: 800;
    color: #fff;
    line-height: 1.1;
  }

  // After:
  .date-day {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--color-accent-ink);
    line-height: 1.1;
  }
  ```

  Fix `.date-month` (line 324–329) — subdued text on same accent card:
  ```scss
  // Before:
  .date-month {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.65);
    line-height: 1;
  }

  // After:
  .date-month {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-accent-ink-muted);
    line-height: 1;
  }
  ```

- [ ] **Step 4: Tokenize 12% icon tints in `recurring.component.scss` (lines 50–51)**

  Find:
  ```scss
  .sc-icon {
    ...
    &.income-icon  { background: rgba(16,229,160,0.12); mat-icon { color: var(--income); } }
    &.expense-icon { background: rgba(248,113,113,0.12); mat-icon { color: var(--expense); } }
  }
  ```
  Replace:
  ```scss
    &.income-icon  { background: var(--color-income-subtle-2); mat-icon { color: var(--income); } }
    &.expense-icon { background: var(--color-expense-subtle-2); mat-icon { color: var(--expense); } }
  ```

- [ ] **Step 5: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/app/pages/tips/tips.component.scss \
           web/src/app/pages/budget/budget.component.scss \
           web/src/app/pages/recurring/recurring.component.scss
  git commit -m "fix(tips,budget,recurring): palette drift, gradient, accent-surface tokens"
  ```

---

## Task 7 — Add Hallmark system stamp to all 8 page component SCSS files

**Files:**
- Modify: `web/src/app/pages/dashboard/dashboard.component.scss`
- Modify: `web/src/app/pages/transactions/transactions.component.scss`
- Modify: `web/src/app/pages/budget/budget.component.scss`
- Modify: `web/src/app/pages/analytics/analytics.component.scss`
- Modify: `web/src/app/pages/compare/compare.component.scss`
- Modify: `web/src/app/pages/recurring/recurring.component.scss`
- Modify: `web/src/app/pages/statistics/statistics.component.scss`
- Modify: `web/src/app/pages/tips/tips.component.scss`

**Findings closed:** major #8 (missing system reference on all 8 page components)

**Stamp to add:** Insert as the **first line** of each SCSS file — before any existing rules.

```scss
/* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
```

- [ ] **Step 1: Add stamp to `dashboard.component.scss`**

  Insert at line 1 (before `.dash-header {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 2: Add stamp to `transactions.component.scss`**

  Insert at line 1 (before `.filters-card {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 3: Add stamp to `budget.component.scss`**

  Insert at line 1 (before `.budget-page-header {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 4: Add stamp to `analytics.component.scss`**

  Insert at line 1 (before `.an-page {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 5: Add stamp to `compare.component.scss`**

  Insert at line 1 (before `.cp-page {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 6: Add stamp to `recurring.component.scss`**

  Insert at line 1 (before `.rp-page {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 7: Add stamp to `statistics.component.scss`**

  Insert at line 1 (before `.top-row {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 8: Add stamp to `tips.component.scss`**

  Insert at line 1 (before `.tips-page {`):
  ```scss
  /* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: design.md · designed-as-app */
  ```

- [ ] **Step 9: Verify all 8 files are stamped**

  ```bash
  grep -rn "designed-as-app" web/src/app/pages --include="*.scss"
  ```
  Expected: exactly 8 lines, one per page component.

- [ ] **Step 10: Build to verify**

  ```bash
  cd web && pnpm run build 2>&1 | tail -5
  ```
  Expected: `Application bundle generation complete.`

- [ ] **Step 11: Commit**

  ```bash
  git add web/src/app/pages/dashboard/dashboard.component.scss \
           web/src/app/pages/transactions/transactions.component.scss \
           web/src/app/pages/budget/budget.component.scss \
           web/src/app/pages/analytics/analytics.component.scss \
           web/src/app/pages/compare/compare.component.scss \
           web/src/app/pages/recurring/recurring.component.scss \
           web/src/app/pages/statistics/statistics.component.scss \
           web/src/app/pages/tips/tips.component.scss
  git commit -m "chore(hallmark): add design-system stamps to all 8 page components"
  ```

---

## Self-review

**Spec coverage check:**

| Finding | Task | Closed by |
|---|---|---|
| critical: side-stripe card (analytics) | 5 | `.table-row.active` → `background: var(--color-income-subtle)` |
| major: `#111e30` in dropdown-panel | 2 | → `var(--color-paper-2)` |
| major: `#fb923c` in app shell | 2 | → `var(--color-warning)` |
| major: `#fb923c` + rgba(251,146,60,0.15) in statistics | 3 | → `var(--color-warning)` + `var(--color-warning-subtle)` |
| major: glow shadow on live-dot | 3 | `box-shadow` removed |
| major: layout-property transition + raw ease | 4 | → `transform: scaleX()` + `var(--ease-out)` |
| major: off-palette blue in tips icon | 6 | → `var(--color-accent-subtle)` |
| major: missing stamps on 8 pages | 7 | Stamp added to all 8 |
| minor: `rgba(16,229,160,0.06)` on active row | 5 | → `var(--color-income-subtle)` |
| minor: `#fff` on accent surface (recurring) | 6 | → `var(--color-accent-ink)` |
| minor: `rgba(255,255,255,0.65)` on accent (recurring) | 6 | → `var(--color-accent-ink-muted)` |
| minor: 12% semantic tints without tokens (styles.scss) | 4 | → `--color-income-subtle-2`, `--color-expense-subtle-2` |
| minor: decorative gradient in budget | 6 | → `var(--color-accent-subtle)`, opacity removed |
| minor: white-overlay hover states not tokenized | 2 | → `var(--color-surface-hover)` |

All 14 findings covered. ✓

**Placeholder scan:** No TBDs, no "similar to Task N", all code blocks complete. ✓

**Token consistency:** All new tokens defined in Task 1 (`--color-surface-hover`, `--color-income-subtle-2`, `--color-expense-subtle-2`, `--color-accent-ink-muted`) are referenced by exact name in Tasks 2, 3, 4, 6. ✓

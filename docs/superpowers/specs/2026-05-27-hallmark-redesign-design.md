# AccBot Web Dashboard — Hallmark Redesign Design Spec

> **For agentic workers:** This spec drives a `/writing-plans` implementation plan.
> Every change traces to a named Hallmark audit finding. No change ships without a finding citation.

**Goal:** Fix all 11 Hallmark audit findings (3 critical · 4 major · 4 minor) by establishing a locked
design system (`design.md` + `tokens.css`) and applying it surgically across the 8-page Angular 17
dashboard. Result: a coherent atmospheric-genre dark dashboard with proper OKLCH tokens, a display
font, mobile drawer, focus-visible states, tabular numerics, and no AI-slop tells.

**Genre:** Atmospheric (Vercel / Raycast school — dark background as feature, lightness-based elevation)

**Approach:** Karpathy-disciplined — every changed line traces to an audit finding. No refactors
for aesthetics alone.

---

## Audit Findings Being Addressed

| # | Finding | Severity | Section |
|---|---|---|---|
| 1 | Inter-everywhere — no display face, font-family inline in 5 SCSS files | critical | Design system + per-page |
| 2 | Side-stripe card — tips cards use `border-left: 3px solid` | critical | Tips page |
| 3 | No `overflow-x: clip` on html/body | critical | Design system |
| 4 | Mid-render token improvisation — raw hex outside `:root` in 4 locations | major | Design system + shell + recurring |
| 5 | Hover-only affordances — no `:focus-visible` anywhere | major | Shell + all pages |
| 6 | Tabular data without `tabular-nums` | major | Per-page sweep |
| 7 | Tips grid = 3-column feature grid (equal columns) | major | Tips page |
| 8 | Inconsistent h1 type scale (1.9rem / 1.75rem / 1.5rem) | minor | Design system token + 4 page SCSS files |
| 9 | Inline `style="margin-top:24px"` in budget template | minor | Budget page |
| 10 | Dark hover shadow on dark surface (tips cards) | minor | Tips page |
| 11 | `.page-wrap` has `max-width` but no `margin-inline: auto` | minor | Design system |

---

## Section 1 — Design System

### Files
- **Create:** `web/src/tokens.css`
- **Create:** `web/design.md`
- **Modify:** `web/src/styles.scss`
- **Modify:** `web/src/index.html`
- **Modify:** `web/package.json`

### OKLCH Token System (`web/src/tokens.css`)

Full replacement of the current raw hex `:root` block in `styles.scss`.
Every colour used anywhere in the project must resolve to one of these tokens.

```css
/* Hallmark · genre: atmospheric · macrostructure: Workbench (app)
 * theme: custom atmospheric · anchor: oklch(70% 0.14 200) cyan-teal
 * display: Geist 700 · body: Inter 400/500
 * design-system: design.md · designed-as-app
 */
:root {
  /* ── Surfaces ─────────────────────────────── */
  --color-paper:         oklch(13%   0.03  230);   /* page bg          #080e1a equiv */
  --color-paper-2:       oklch(16%   0.04  230);   /* card surface     #0e1726 equiv */
  --color-paper-3:       oklch(18%   0.04  230);   /* elevated card    #111e30 equiv */
  --color-paper-sidebar: oklch(14.5% 0.035 230);   /* sidebar bg       #0a1120 equiv — was untracked */

  /* ── Ink ──────────────────────────────────── */
  --color-ink:           oklch(90%   0.015 230);   /* primary text     #e2e8f0 equiv */
  --color-ink-2:         oklch(48%   0.02  230);   /* muted text       #64748b equiv */
  --color-rule:          oklch(100%  0     0 / 7%);/* borders          rgba(255,255,255,0.07) equiv */

  /* ── Brand accent ─────────────────────────── */
  --color-accent:        oklch(70%   0.14  200);   /* cyan-teal        replaces #3b82f6 blue */
  --color-accent-light:  oklch(72%   0.12  230);   /* softer accent    replaces #60a5fa — was untracked */
  --color-accent-ink:    oklch(98%   0.01  200);   /* text on accent   */
  --color-focus:         oklch(70%   0.14  200);   /* focus ring       same hue as accent */

  /* ── Semantic ─────────────────────────────── */
  --color-income:        oklch(81%   0.18  168);   /* green            #10e5a0 equiv */
  --color-expense:       oklch(72%   0.18   25);   /* red              #f87171 equiv */
  --color-net:           oklch(74%   0.15  210);   /* cyan             #38bdf8 equiv */
  --color-warning:       oklch(77%   0.17   80);   /* amber            #f59e0b equiv — was untracked */

  /* ── Subtle background tints (for card variants) ── */
  --color-expense-subtle: oklch(72% 0.18  25 / 8%);
  --color-warning-subtle: oklch(77% 0.17  80 / 8%);
  --color-income-subtle:  oklch(81% 0.18 168 / 6%);
  --color-accent-subtle:  oklch(70% 0.14 200 / 18%); /* nav-item active bg */

  /* ── Typography ───────────────────────────── */
  --font-display: 'Geist', sans-serif;
  --font-body:    'Inter', sans-serif;
  --font-mono:    'Geist Mono', monospace;

  /* ── Type scale ───────────────────────────── */
  --text-xs:         0.75rem;
  --text-sm:         0.875rem;
  --text-md:         1rem;
  --text-lg:         1.125rem;
  --text-xl:         1.375rem;
  --text-2xl:        1.75rem;
  --text-page-title: clamp(1.5rem, 2.5vw, 1.75rem);  /* unifies 1.9/1.75/1.5rem inconsistency */

  /* ── Spacing (4-pt scale) ─────────────────── */
  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs:  0.75rem;
  --space-sm:  1rem;
  --space-md:  1.5rem;
  --space-lg:  2rem;
  --space-xl:  3rem;
  --space-2xl: 4.5rem;

  /* ── Motion ───────────────────────────────── */
  --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 150ms;
  --dur-base:  220ms;

  /* ── Radius ───────────────────────────────── */
  --radius:       14px;
  --radius-sm:    8px;
  --radius-pill:  20px;

  /* ── Legacy aliases (keep old names working during migration) ── */
  --bg:          var(--color-paper);
  --bg-card:     var(--color-paper-2);
  --bg-card-alt: var(--color-paper-3);
  --border:      var(--color-rule);
  --text:        var(--color-ink);
  --text-muted:  var(--color-ink-2);
  --income:      var(--color-income);
  --expense:     var(--color-expense);
  --net:         var(--color-net);
  --accent:      var(--color-accent);
}
```

> **Legacy aliases:** The last block keeps the old `--bg`, `--border`, `--text`, etc. tokens working
> so page components that already use them don't need a mechanical find-replace. They resolve
> through to the new OKLCH values. This is the minimum-change path per Karpathy principle #3.

### `styles.scss` changes

1. Remove the existing `:root {}` block entirely — `tokens.css` owns all tokens now.
2. Add `@import 'tokens.css'` at top of file (or `@use` — match project convention).
3. Add to `html, body {}`:
   ```scss
   overflow-x: clip;  // gate 62 — critical finding #3
   ```
4. Add to `.page-wrap`:
   ```scss
   margin-inline: auto;  // minor finding #11
   ```
5. Add to `.stat-amount`, `.tx-amount` (global shared classes):
   ```scss
   font-variant-numeric: tabular-nums;  // major finding #6
   ```

### Font loading (`web/src/index.html` + `package.json`)

Add `@fontsource/geist` and `@fontsource/geist-mono` as npm deps.
Import in `index.html`:
```html
<link rel="preload" href="/fonts/geist-latin-700.woff2" as="font" crossorigin>
```
Or via `styles` array in `angular.json` — match existing project convention.

---

## Section 2 — Shell (`app.component`)

### Files
- **Modify:** `web/src/app/app.component.ts`
- **Modify:** `web/src/app/app.component.html`
- **Modify:** `web/src/app/app.component.scss`

### 2a. Mobile drawer *(critical finding #3)*

**`app.component.ts`:** Add `mobileOpen = false` property. Add `toggleMobile()` method.
Subscribe to `Router.events` (filter `NavigationStart`) to set `mobileOpen = false` on navigation.
Inject `Router` in constructor.

**`app.component.html`:** 
- Add `<button class="hamburger-btn" (click)="toggleMobile()">` inside `.topbar` (left side, mobile only).
- Add `<div class="drawer-backdrop" (click)="toggleMobile()"></div>` as sibling of `.sidebar`.
- Add `[class.mobile-open]="mobileOpen"` to `.shell`.

**`app.component.scss`:**
```scss
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    inset-block: 0;
    left: 0;
    z-index: 200;
    transform: translateX(-100%);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .mobile-open .sidebar {
    transform: translateX(0);
  }
  .drawer-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: oklch(0% 0 0 / 50%);
    z-index: 199;
  }
  .mobile-open .drawer-backdrop {
    display: block;
  }
  .hamburger-btn {
    display: flex;
  }
  .main { width: 100%; }
}
.hamburger-btn { display: none; } // hidden on desktop
```

### 2b. Token migration *(major finding #4 — shell portion)*

In `app.component.scss`:
- `background: #0a1120` → `var(--color-paper-sidebar)`
- `.nav-item.active` rgba background → `oklch(from var(--color-accent) l c h / 18%)` 
  or simpler: add `--color-accent-subtle: oklch(70% 0.14 200 / 18%)` to tokens and use it
- `background: var(--accent)` on `.brand-icon`, `.avatar`, `.date-card` → `var(--color-accent)` 
  (these already use `var(--accent)` which aliases, so no change needed — alias covers it)

In `app.component.html`:
- Line 87: `[style.background]="b.percentage >= 100 ? '#f87171' : '#fb923c'"` →
  Extract to `budgetBarBg(pct: number): string` method in `app.component.ts`:
  ```ts
  budgetBarBg(pct: number): string {
    return pct >= 100 ? 'var(--color-expense)' : 'var(--color-warning)';
  }
  ```

### 2c. Focus-visible — shell *(major finding #5, shell portion)*

In `app.component.scss`, add `:focus-visible` companion to every `:hover` rule:
- `.nav-item:focus-visible` — same background/color as hover + `outline: 2px solid var(--color-focus); outline-offset: -2px`
- `.collapse-btn:focus-visible` — same as hover
- `.icon-btn:focus-visible` — same as hover
- `.logout-btn:focus-visible` — same as hover
- `.settings-item:focus-visible` — same as hover

Also in `.settings-item`:
- `font-family: 'Inter', sans-serif` → `font-family: var(--font-body)` *(critical finding #1)*

---

## Section 3 — Per-page Changes

### Ground rule
Every change cites its finding. No change without a citation.

---

### `tips.component.scss` + `tips.component.html`

**Critical #2 — side-stripe removal:**
```scss
// Remove:
&.priority-high   { border-left: 3px solid var(--expense); }
&.priority-medium { border-left: 3px solid #f59e0b; }
&.priority-low    { border-left: 3px solid var(--income); }

// Replace with:
&.priority-high   { background: var(--color-expense-subtle); }
&.priority-medium { background: var(--color-warning-subtle); }
&.priority-low    { background: var(--color-income-subtle); }
```

**Major #4 — raw hex:**
The `#f59e0b` value in `.priority-badge` styles → `var(--color-warning)`.

**Major #7 — break 3-column grid:**
```scss
// One rule added to tips.component.scss:
.tip-card.priority-high {
  grid-column: span 2;
}
```
At standard viewport (3-col auto-fill) → high-priority card spans ⅔ width. Asymmetry achieved
with 1 line. Karpathy-approved.

**Minor #10 — dark shadow on dark:**
```scss
// Remove:
&:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35); }

// Replace with:
&:hover, &:focus-visible { background: var(--color-paper-3); }
```
Lightness elevation instead of invisible shadow. Focus-visible added at the same time *(finding #5)*.

**Critical #1 — font-family token (tips has `h1` with literal size):**
- `h1 { font-size: 1.5rem }` → `h1 { font-size: var(--text-page-title) }` *(minor #8)*

---

### `transactions.component.scss`

**Critical #1 — font-family literals:**
- Lines 33, 62, 110: `font-family: 'Inter', sans-serif` → `font-family: var(--font-body)`

**Major #5 — focus-visible:**
- `.search-input`: upgrade `:focus` → `:focus-visible`
- `.filter-select`: upgrade `:focus` → `:focus-visible`  
- `.filter-date`: upgrade `:focus` → `:focus-visible`
- `.export-btn`: add `:focus-visible` alongside `:hover`
- `.load-more-btn`: add `:focus-visible` alongside `:hover`

**Major #6 — tabular-nums:**
- `.tx-amount` already covered by global rule in `styles.scss`. No local change needed.

---

### `compare.component.scss`

**Critical #1 — font-family literal:**
- Line 46: `.picker-select { font-family: 'Inter', sans-serif }` → `var(--font-body)`

**Minor #8 — h1 scale:**
- `.cp-header h1 { font-size: 1.75rem }` → `var(--text-page-title)`

**Major #5 — focus-visible:**
- `.picker-select`: upgrade `:focus` → `:focus-visible`
- `.compare-btn`: add `:focus-visible` alongside `:hover`
- `.retry-btn`: add `:focus-visible` alongside `:hover`

**Major #6 — tabular-nums:**
- `.stat-value`: add `font-variant-numeric: tabular-nums`

---

### `recurring.component.scss`

**Major #4 — raw hex:**
- `.days-badge.today { color: #60a5fa }` → `var(--color-accent-light)`

**Minor #8 — h1 scale:**
- `.rp-header h1 { font-size: 1.75rem }` → `var(--text-page-title)`

**Major #5 — focus-visible:**
- `.retry-btn`: add `:focus-visible` alongside `:hover`

**Major #6 — tabular-nums:**
- `.sc-amount`, `.upcoming-amount`, `.billed-amount`, `.row-amount`: add `font-variant-numeric: tabular-nums`

---

### `budget.component.html` + `budget.component.scss`

**Minor #9 — inline style:**
- `budget.component.html`: Remove `style="margin-top:24px"` from `.section-header` div.
  Add class `section-header--budget-gap` to that element.
- `budget.component.scss`: Add `.section-header--budget-gap { margin-top: var(--space-lg); }`

**Major #5 — focus-visible:**
- `.new-budget-btn`: currently `opacity: 0.6` + `disabled`. The `disabled` attribute suppresses
  focus natively — no focus-visible rule needed. *(No change required — disabled attr handles it.)*

**Major #6 — tabular-nums:**
- `.cbc-budget-amount`, `.hero-amount`, `.sc-amount` (if present): add `font-variant-numeric: tabular-nums`

---

### `analytics.component.scss`

**Minor #8 — h1 scale:**
- `.an-header h1 { font-size: 1.75rem }` → `var(--text-page-title)`

**Major #5 — focus-visible:**
- `.table-row` (clickable): add `:focus-visible` with `outline: 2px solid var(--color-focus); outline-offset: -2px`
  Also add `tabindex="0"` to the `.table-row` in `analytics.component.html` so it's keyboard-reachable.

**Major #6 — tabular-nums:**
- `.tx-amount`, `.tx-count`: add `font-variant-numeric: tabular-nums`

---

### `statistics.component.scss`

**Major #6 — tabular-nums:**
- `.savings-rate`, `.pill-val`: add `font-variant-numeric: tabular-nums`

*(Statistics has no interactive elements beyond charts — no focus-visible changes needed.)*

---

### `dashboard.component.scss`

*(No audit findings specific to dashboard beyond global token/tabular-nums already covered by
`styles.scss` shared classes. No changes needed here per Karpathy principle #3.)*

---

## File Inventory

| Action | File | Finding(s) |
|---|---|---|
| Create | `web/design.md` | System |
| Create | `web/src/tokens.css` | #1 #3 #4 #8 #11 |
| Modify | `web/package.json` | Font dependency |
| Modify | `web/src/index.html` | Font loading |
| Modify | `web/src/styles.scss` | #3 #6 #8 #11 |
| Modify | `web/src/app/app.component.ts` | #3 #4 |
| Modify | `web/src/app/app.component.html` | #3 #4 |
| Modify | `web/src/app/app.component.scss` | #1 #4 #5 |
| Modify | `web/src/app/pages/tips/tips.component.scss` | #1 #2 #4 #5 #7 #8 #10 |
| Modify | `web/src/app/pages/tips/tips.component.html` | #7 (tabindex) |
| Modify | `web/src/app/pages/transactions/transactions.component.scss` | #1 #5 |
| Modify | `web/src/app/pages/compare/compare.component.scss` | #1 #5 #6 #8 |
| Modify | `web/src/app/pages/recurring/recurring.component.scss` | #4 #5 #6 #8 |
| Modify | `web/src/app/pages/budget/budget.component.html` | #9 |
| Modify | `web/src/app/pages/budget/budget.component.scss` | #5 #6 #9 |
| Modify | `web/src/app/pages/analytics/analytics.component.scss` | #5 #6 #8 |
| Modify | `web/src/app/pages/analytics/analytics.component.html` | #5 (tabindex) |
| Modify | `web/src/app/pages/statistics/statistics.component.scss` | #6 |

**18 files · 2 created · 16 modified · 0 deleted**

---

## Success Criteria

- [ ] `pnpm build` in `web/` compiles with zero errors
- [ ] All 11 audit findings have a closed state (each traced to a specific changed line)
- [ ] No raw hex values remain outside `tokens.css`
- [ ] No `font-family: 'Inter'` or `font-family: 'Geist'` literals outside `tokens.css`
- [ ] `html, body` both have `overflow-x: clip` in compiled CSS
- [ ] Every interactive element visible in the browser has a visible focus ring on keyboard nav
- [ ] Sidebar works on 375px viewport (hamburger visible, drawer slides in, closes on nav)
- [ ] Currency columns in Dashboard, Transactions, Budget, Analytics, Statistics align vertically
- [ ] Tips page has no equal-width 3-column lock at standard viewport

---

## Out of Scope

- No changes to routing, data fetching, API calls, or business logic
- No changes to the Telegram bot (`repo/`) or API (`api/`)
- No new Angular components beyond what's described above
- No animation library installation
- No changes to `app.routes.ts`, service files, or module files

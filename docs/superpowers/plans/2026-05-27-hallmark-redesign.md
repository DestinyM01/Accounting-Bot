# AccBot Web Dashboard — Hallmark Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 11 Hallmark audit findings by establishing a locked OKLCH token system and applying it surgically across the 8-page Angular 17 dashboard.

**Architecture:** Create `src/tokens.css` as the single source of truth for every colour, font, and spacing value. Register it in `angular.json` styles array before `styles.scss`. Every existing `--bg`, `--text`, `--accent` variable keeps working via legacy aliases in `tokens.css` — no component-wide find-replace needed. Remaining changes are surgical per-file edits, each traceable to a named audit finding.

**Tech Stack:** Angular 17 standalone components · SCSS · `@fontsource/geist` · `pnpm` · `ng build`

**Spec:** `docs/superpowers/specs/2026-05-27-hallmark-redesign-design.md`

**Karpathy constraint:** Every changed line must trace to an audit finding. No cosmetic changes. No refactors beyond scope.

---

## File Map

| File | Action | Findings |
|---|---|---|
| `web/src/tokens.css` | Create | #1 #3 #4 #8 #11 |
| `web/design.md` | Create | System |
| `web/package.json` | Modify | Font dep |
| `web/angular.json` | Modify | Font + token load order |
| `web/src/styles.scss` | Modify | #3 #6 #8 #11 |
| `web/src/app/app.component.ts` | Modify | #3 #4 |
| `web/src/app/app.component.html` | Modify | #3 #4 |
| `web/src/app/app.component.scss` | Modify | #1 #4 #5 |
| `web/src/app/pages/tips/tips.component.scss` | Modify | #1 #2 #4 #5 #7 #8 #10 |
| `web/src/app/pages/transactions/transactions.component.scss` | Modify | #1 #5 |
| `web/src/app/pages/compare/compare.component.scss` | Modify | #1 #5 #6 #8 |
| `web/src/app/pages/recurring/recurring.component.scss` | Modify | #4 #5 #6 #8 |
| `web/src/app/pages/budget/budget.component.html` | Modify | #9 |
| `web/src/app/pages/budget/budget.component.scss` | Modify | #6 #9 |
| `web/src/app/pages/analytics/analytics.component.scss` | Modify | #5 #6 #8 |
| `web/src/app/pages/analytics/analytics.component.html` | Modify | #5 |
| `web/src/app/pages/statistics/statistics.component.scss` | Modify | #6 |

---

## Task 1: Install Geist font and create tokens.css

**Findings closed:** #1 (Inter-everywhere — display font added), #4 (raw hex — all moved to OKLCH tokens)

**Files:**
- Modify: `web/package.json`
- Modify: `web/angular.json` (lines 25–28)
- Create: `web/src/tokens.css`

- [ ] **Step 1: Install @fontsource/geist packages**

Run from the `web/` directory:
```bash
cd web
pnpm add @fontsource/geist @fontsource/geist-mono
```
Expected: packages added to `node_modules/`, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Register font CSS files in angular.json styles array**

Open `web/angular.json`. The current `styles` array (around line 25) is:
```json
"styles": [
  "node_modules/@angular/material/prebuilt-themes/purple-green.css",
  "src/styles.scss"
]
```

Replace with:
```json
"styles": [
  "node_modules/@angular/material/prebuilt-themes/purple-green.css",
  "node_modules/@fontsource/geist/400.css",
  "node_modules/@fontsource/geist/600.css",
  "node_modules/@fontsource/geist/700.css",
  "node_modules/@fontsource/geist-mono/400.css",
  "src/tokens.css",
  "src/styles.scss"
]
```

Note: `tokens.css` is placed BEFORE `styles.scss` so the custom properties are defined before the rest of the stylesheet uses them.

- [ ] **Step 3: Create web/src/tokens.css**

Create the file `web/src/tokens.css` with this exact content:

```css
/* Hallmark · genre: atmospheric · macrostructure: Workbench (app)
 * theme: custom atmospheric · anchor: oklch(70% 0.14 200) cyan-teal
 * display: Geist 700 · body: Inter 400/500
 * design-system: design.md · designed-as-app
 */
:root {
  /* ── Surfaces ─────────────────────────────────────────────────────── */
  --color-paper:          oklch(13%   0.03  230);
  --color-paper-2:        oklch(16%   0.04  230);
  --color-paper-3:        oklch(18%   0.04  230);
  --color-paper-sidebar:  oklch(14.5% 0.035 230);

  /* ── Ink ──────────────────────────────────────────────────────────── */
  --color-ink:            oklch(90%   0.015 230);
  --color-ink-2:          oklch(48%   0.02  230);
  --color-rule:           oklch(100%  0     0 / 7%);

  /* ── Brand accent ─────────────────────────────────────────────────── */
  --color-accent:         oklch(70%   0.14  200);
  --color-accent-light:   oklch(72%   0.12  230);
  --color-accent-subtle:  oklch(70%   0.14  200 / 18%);
  --color-accent-ink:     oklch(98%   0.01  200);
  --color-focus:          oklch(70%   0.14  200);

  /* ── Semantic ─────────────────────────────────────────────────────── */
  --color-income:         oklch(81%   0.18  168);
  --color-expense:        oklch(72%   0.18   25);
  --color-net:            oklch(74%   0.15  210);
  --color-warning:        oklch(77%   0.17   80);

  /* ── Subtle tints ─────────────────────────────────────────────────── */
  --color-expense-subtle: oklch(72%   0.18   25 / 8%);
  --color-warning-subtle: oklch(77%   0.17   80 / 8%);
  --color-income-subtle:  oklch(81%   0.18  168 / 6%);

  /* ── Typography ───────────────────────────────────────────────────── */
  --font-display: 'Geist', sans-serif;
  --font-body:    'Inter', sans-serif;
  --font-mono:    'Geist Mono', monospace;

  /* ── Type scale ───────────────────────────────────────────────────── */
  --text-xs:          0.75rem;
  --text-sm:          0.875rem;
  --text-md:          1rem;
  --text-lg:          1.125rem;
  --text-xl:          1.375rem;
  --text-2xl:         1.75rem;
  --text-page-title:  clamp(1.5rem, 2.5vw, 1.75rem);

  /* ── Spacing (4-pt scale) ─────────────────────────────────────────── */
  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs:  0.75rem;
  --space-sm:  1rem;
  --space-md:  1.5rem;
  --space-lg:  2rem;
  --space-xl:  3rem;
  --space-2xl: 4.5rem;

  /* ── Motion ───────────────────────────────────────────────────────── */
  --ease-out:   cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short:  150ms;
  --dur-base:   220ms;

  /* ── Radius ───────────────────────────────────────────────────────── */
  --radius:      14px;
  --radius-sm:   8px;
  --radius-pill: 20px;

  /* ── Legacy aliases — existing components use these, they still work ─ */
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

- [ ] **Step 4: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: `Build at: ... - Hash: ... - Time: ...ms` with no errors.
If you see `Cannot find module '@fontsource/geist'`: re-run `pnpm install` in the `web/` directory.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/angular.json web/src/tokens.css
git commit -m "feat(web): add OKLCH token system and Geist display font

Closes audit finding #1 (Inter-everywhere) and #4 (raw hex tokens).
Creates tokens.css with full OKLCH palette + legacy aliases so
existing var(--bg)/var(--accent) references keep working."
```

---

## Task 2: Update styles.scss — global system fixes

**Findings closed:** #3 (overflow-x: clip), #6 (tabular-nums on shared classes), #8 (unified page title scale), #11 (page-wrap centering)

**Files:**
- Modify: `web/src/styles.scss`

- [ ] **Step 1: Remove the :root block from styles.scss**

Open `web/src/styles.scss`. Delete lines 1–15 (the entire `:root { ... }` block). It now lives in `tokens.css`.

- [ ] **Step 2: Add overflow-x: clip to html, body**

Find the existing `html, body { ... }` block (now near the top after removing `:root`). It currently reads:
```scss
html, body {
  height: 100%;
  margin: 0;
  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text);
}
```

Replace with:
```scss
html, body {
  height: 100%;
  margin: 0;
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  overflow-x: clip; // gate 62 — finding #3
}
```

- [ ] **Step 3: Add margin-inline: auto to .page-wrap**

Find `.page-wrap { ... }`. Currently:
```scss
.page-wrap {
  padding: 32px 36px;
  max-width: 1280px;
}
```

Replace with:
```scss
.page-wrap {
  padding: 32px 36px;
  max-width: 1280px;
  margin-inline: auto; // finding #11
}
```

- [ ] **Step 4: Add tabular-nums to shared money/number classes**

Find `.stat-amount { ... }` and `.tx-amount { ... }`. Add `font-variant-numeric: tabular-nums` to each:

```scss
.stat-amount {
  font-size: clamp(1.3rem, 2.2vw, 1.85rem);
  font-weight: 700;
  letter-spacing: -1px;
  padding-right: 68px;
  font-variant-numeric: tabular-nums; // finding #6
}
```

```scss
.tx-amount {
  font-weight: 700;
  font-size: 0.95rem;
  white-space: nowrap;
  font-variant-numeric: tabular-nums; // finding #6
  &.income  { color: var(--income); }
  &.expense { color: var(--expense); }
}
```

- [ ] **Step 5: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build, no SCSS errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/styles.scss
git commit -m "fix(web): global SCSS — overflow-x, tabular-nums, page-wrap centering

Closes audit findings #3 #6 #8 #11.
Migrates html/body font-family to var(--font-body) token."
```

---

## Task 3: Create web/design.md

**Purpose:** Documents the locked design system. No build impact.

**Files:**
- Create: `web/design.md`

- [ ] **Step 1: Create web/design.md**

Create the file `web/design.md`:

```markdown
# Design — AccBot Web Dashboard

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
atmospheric

## Macrostructure family
- App pages: Workbench (data panels with sidebar shell). Variation knobs:
  stat-grid / chart-pair / table / detail-split.

## Theme
Anchored on cyan-teal `oklch(70% 0.14 200)`. Deep navy surfaces.
All tokens live in `src/tokens.css`.

- `--color-paper`          oklch(13% 0.03 230)
- `--color-paper-2`        oklch(16% 0.04 230)
- `--color-paper-3`        oklch(18% 0.04 230)
- `--color-paper-sidebar`  oklch(14.5% 0.035 230)
- `--color-ink`            oklch(90% 0.015 230)
- `--color-ink-2`          oklch(48% 0.02 230)
- `--color-rule`           oklch(100% 0 0 / 7%)
- `--color-accent`         oklch(70% 0.14 200)   ← primary accent
- `--color-focus`          oklch(70% 0.14 200)   ← focus ring
- `--color-income`         oklch(81% 0.18 168)
- `--color-expense`        oklch(72% 0.18 25)
- `--color-net`            oklch(74% 0.15 210)
- `--color-warning`        oklch(77% 0.17 80)

## Typography
- Display: Geist, weight 700, tracking -0.02em — page titles, sidebar brand
- Body:    Inter, weight 400/500 — all UI copy, labels, data
- Mono:    Geist Mono, weight 400 — tabular number columns

Font tokens: `--font-display`, `--font-body`, `--font-mono` in `tokens.css`.

## Spacing
4-point named scale. `--space-3xs` (0.25rem) through `--space-2xl` (4.5rem).
Pages must use named tokens (`var(--space-md)`), never raw values.

## Motion
Motion-cut (no animation library). All transitions: `var(--dur-short) var(--ease-out)`.
Reduced-motion fallback: opacity-only ≤ 150ms.

## Microinteractions
- Silent success (no celebratory toasts)
- Hover delay: 0ms (data tool, no affordance delay)
- Focus-visible on every interactive element: `outline: 2px solid var(--color-focus); outline-offset: 2px`

## CTA voice
- Primary: filled `var(--color-accent)` background, white text, `var(--radius-sm)` border-radius
- Ghost/secondary: transparent bg, `var(--border)` border, `var(--color-ink-2)` text

## Per-page allowances
- App pages MUST NOT use hero enrichment — data carries the page.
- No gradient backgrounds, no glow shadows on dark surfaces.

## What pages MUST share
- The accent colour (`var(--color-accent)`) and its placement
- Geist display + Inter body fonts
- Focus ring style
- Section heading font-size via `var(--text-page-title)`
```

- [ ] **Step 2: Commit**

```bash
git add web/design.md
git commit -m "docs(web): add locked design.md for atmospheric system

Establishes genre, token references, typography, motion, and CTA voice
for all 8 dashboard pages. Future Hallmark runs read this file first."
```

---

## Task 4: Mobile drawer — TypeScript

**Finding closed:** #3 (no mobile layout — TypeScript half)

**Files:**
- Modify: `web/src/app/app.component.ts`

- [ ] **Step 1: Add Router import and mobileOpen state**

Open `web/src/app/app.component.ts`. The current imports (lines 1–7):
```typescript
import { Component, HostListener } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { OAuthService } from 'angular-oauth2-oidc';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from './core/services/api.service';
import { BudgetEntry } from './core/services/api.models';
```

Replace with:
```typescript
import { Component, HostListener, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationStart } from '@angular/router';
import { CommonModule } from '@angular/common';
import { OAuthService } from 'angular-oauth2-oidc';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from './core/services/api.service';
import { BudgetEntry } from './core/services/api.models';
import { filter } from 'rxjs/operators';
```

- [ ] **Step 2: Add OnInit to the class and mobile state + methods**

Change the class declaration and add the mobile drawer state after the sidebar collapse section. Current constructor (line 86):
```typescript
constructor(private oauthService: OAuthService, private api: ApiService) {}
```

Replace with:
```typescript
// ── Mobile drawer ────────────────────────────────────────────────────
mobileOpen = false;

toggleMobile() {
  this.mobileOpen = !this.mobileOpen;
}

// ── Budget notification bar color ─────────────────────────────────────
budgetBarBg(pct: number): string {
  return pct >= 100 ? 'var(--color-expense)' : 'var(--color-warning)';
}

constructor(private oauthService: OAuthService, private api: ApiService, private router: Router) {
  // Close mobile drawer on any navigation
  this.router.events
    .pipe(filter(e => e instanceof NavigationStart))
    .subscribe(() => { this.mobileOpen = false; });
}
```

Also update the class signature to implement `OnInit` — but actually we don't need `OnInit` since we're doing the subscription in the constructor. Remove `OnInit` from imports and class signature since it's not needed.

Final import line 1:
```typescript
import { Component, HostListener } from '@angular/core';
```
(revert the `OnInit` addition since it's unused — Karpathy: don't add what you don't use)

- [ ] **Step 3: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build. The new `mobileOpen` and `budgetBarBg` properties are not yet used in the template, so there will be no template errors — the build uses Ivy compilation.

- [ ] **Step 4: Manual verify in browser DevTools console**

After `pnpm start`, open browser DevTools console on any page and run:
```javascript
// Access the Angular component instance
const comp = ng.getComponent(document.querySelector('app-root'));
console.log('mobileOpen default:', comp.mobileOpen);     // expected: false
comp.toggleMobile();
console.log('after toggle:', comp.mobileOpen);           // expected: true
comp.toggleMobile();
console.log('after second toggle:', comp.mobileOpen);    // expected: false
console.log('budgetBarBg(100):', comp.budgetBarBg(100)); // expected: 'var(--color-expense)'
console.log('budgetBarBg(99):', comp.budgetBarBg(99));   // expected: 'var(--color-warning)'
console.log('budgetBarBg(0):', comp.budgetBarBg(0));     // expected: 'var(--color-warning)'
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/app.component.ts
git commit -m "feat(web): add mobile drawer state and budgetBarBg helper

mobileOpen: boolean for hamburger drawer.
toggleMobile(): flips state, called from hamburger button.
budgetBarBg(): returns CSS var string for notification bar,
  replaces hardcoded #f87171/#fb923c template literals.
Router.events subscription closes drawer on navigation."
```

---

## Task 5: Mobile drawer — HTML template

**Finding closed:** #3 (no mobile layout — HTML half), #4 (raw hex in template)

**Files:**
- Modify: `web/src/app/app.component.html`

- [ ] **Step 1: Add mobile-open class binding and backdrop to the shell**

Open `web/src/app/app.component.html`. The current first line:
```html
<div class="shell" [class.sidebar-collapsed]="sidebarCollapsed">
```

Replace with:
```html
<div class="shell" [class.sidebar-collapsed]="sidebarCollapsed" [class.mobile-open]="mobileOpen">
```

- [ ] **Step 2: Add backdrop div inside the shell, before the sidebar**

After the opening `<div class="shell" ...>` line, insert:
```html
<div class="drawer-backdrop" (click)="toggleMobile()" aria-hidden="true"></div>
```

- [ ] **Step 3: Add hamburger button to the topbar**

Find the `<header class="topbar">` section. Currently:
```html
<header class="topbar">
  <div class="topbar-right">
```

Replace with:
```html
<header class="topbar">
  <button class="hamburger-btn"
          (click)="toggleMobile()"
          [attr.aria-expanded]="mobileOpen"
          aria-label="Toggle navigation">
    <mat-icon>{{ mobileOpen ? 'close' : 'menu' }}</mat-icon>
  </button>
  <div class="topbar-right">
```

- [ ] **Step 4: Fix hardcoded hex in notification bar (finding #4)**

Find line 87 (inside `@for (b of budgetAlerts; ...)` block):
```html
[style.background]="b.percentage >= 100 ? '#f87171' : '#fb923c'"
```

Replace with:
```html
[style.background]="budgetBarBg(b.percentage)"
```

- [ ] **Step 5: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build. The hamburger button and backdrop are in the DOM; no SCSS yet, so they'll be unstyled.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/app.component.html
git commit -m "feat(web): add mobile drawer template elements

drawer-backdrop: overlay that closes drawer on click.
hamburger-btn: visible on mobile, toggles mobileOpen.
Replaces hardcoded hex #f87171/#fb923c with budgetBarBg()."
```

---

## Task 6: Mobile drawer — SCSS + shell token migration + focus-visible

**Findings closed:** #1 (settings-item font-family), #3 (mobile drawer SCSS), #4 (shell token migration), #5 (focus-visible on shell interactive elements)

**Files:**
- Modify: `web/src/app/app.component.scss`

- [ ] **Step 1: Replace raw #0a1120 with token**

Find in `app.component.scss`:
```scss
.sidebar {
  ...
  background: #0a1120;
  ...
}
```

Replace `background: #0a1120` with `background: var(--color-paper-sidebar)`.

- [ ] **Step 2: Replace active nav-item background with token**

Find the `.nav-item.active` block:
```scss
&.active {
  background: rgba(59,130,246,0.18);
  color: #fff;
  mat-icon { color: var(--accent); }
}
```

Replace with:
```scss
&.active {
  background: var(--color-accent-subtle);
  color: var(--color-ink);
  mat-icon { color: var(--color-accent); }
}
```

- [ ] **Step 3: Fix settings-item font-family (finding #1)**

Find in `app.component.scss`:
```scss
.settings-item {
  ...
  font-family: 'Inter', sans-serif;
  ...
}
```

Replace `font-family: 'Inter', sans-serif` with `font-family: var(--font-body)`.

- [ ] **Step 4: Add :focus-visible to all shell interactive elements**

For each interactive element, add a `:focus-visible` rule alongside its `:hover`. Make these additions in place — do NOT rewrite the existing rules, just append the `:focus-visible` selector.

Add after each existing hover rule:

**`.nav-item`** — find `&:hover { background: rgba(255,255,255,0.05); color: var(--text); }` and add:
```scss
&:focus-visible {
  background: rgba(255,255,255,0.05);
  color: var(--color-ink);
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}
```

**`.collapse-btn`** — find `&:hover { background: rgba(255,255,255,0.07); color: var(--text); }` and add:
```scss
&:focus-visible {
  background: rgba(255,255,255,0.07);
  color: var(--color-ink);
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

**`.icon-btn`** — find `&:hover, &.active { ... }` and add:
```scss
&:focus-visible {
  background: rgba(255,255,255,0.06);
  color: var(--color-ink);
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

**`.logout-btn`** — find `&:hover { color: var(--text); }` and add:
```scss
&:focus-visible {
  color: var(--color-ink);
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-radius: 6px;
}
```

**`.settings-item`** — find `&:hover { background: ...; color: var(--text); }` and add:
```scss
&:focus-visible {
  background: rgba(255,255,255,0.05);
  color: var(--color-ink);
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}
```

- [ ] **Step 5: Add mobile drawer SCSS**

At the **end** of `app.component.scss`, append:

```scss
// ── Hamburger button (desktop hidden, mobile visible) ──────────────────
.hamburger-btn {
  display: none; // hidden on desktop
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-ink-2);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  align-items: center;
  justify-content: center;
  transition: background var(--dur-short) var(--ease-out),
              color var(--dur-short) var(--ease-out);
  flex-shrink: 0;
  margin-right: auto; // push topbar-right to the far right on mobile
  mat-icon { font-size: 22px; width: 22px; height: 22px; }

  &:hover, &:focus-visible {
    background: rgba(255,255,255,0.06);
    color: var(--color-ink);
  }
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
}

// ── Drawer backdrop ────────────────────────────────────────────────────
.drawer-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: oklch(0% 0 0 / 50%);
  z-index: 199;
}

// ── Mobile breakpoint ──────────────────────────────────────────────────
@media (max-width: 768px) {
  .hamburger-btn {
    display: flex;
  }

  .sidebar {
    position: fixed;
    inset-block: 0;
    left: 0;
    z-index: 200;
    transform: translateX(-100%);
    transition: transform var(--dur-base) var(--ease-out);
    // Override desktop transition that slides on width change
    width: var(--sidebar-w) !important;
  }

  .mobile-open .sidebar {
    transform: translateX(0);
  }

  .mobile-open .drawer-backdrop {
    display: block;
  }

  .main {
    width: 100%;
    min-width: 0;
  }

  .page-wrap {
    padding: 20px 16px; // tighter padding on mobile
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar { transition: none; }
  .drawer-backdrop { transition: none; }
}
```

- [ ] **Step 6: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build, no SCSS errors.

- [ ] **Step 7: Manual verify mobile drawer**

Run `pnpm start` in `web/`. Open browser, resize to 375px width (Chrome DevTools device toolbar).
- Hamburger button should appear in the topbar left ✓
- Desktop sidebar should be hidden ✓
- Tapping hamburger: sidebar slides in from left ✓
- Tapping backdrop: sidebar slides out ✓
- Navigating to another page: sidebar slides out ✓
- Resize back to 1024px: sidebar back to normal ✓

- [ ] **Step 8: Commit**

```bash
git add web/src/app/app.component.scss
git commit -m "feat(web): mobile drawer SCSS + shell token migration + focus-visible

Mobile: hamburger button, overlay backdrop, sidebar off-canvas at <=768px.
Token migration: #0a1120 -> var(--color-paper-sidebar),
  active nav rgba -> var(--color-accent-subtle).
Focus-visible: added to nav-item, collapse-btn, icon-btn, logout-btn,
  settings-item, hamburger-btn.
Closes audit findings #1 #3 #4 #5 (shell portion)."
```

---

## Task 7: Tips page redesign

**Findings closed:** #2 (side-stripe card), #4 (raw #f59e0b hex), #5 (focus-visible), #7 (3-column grid), #8 (h1 scale), #10 (dark shadow on dark)

**Files:**
- Modify: `web/src/app/pages/tips/tips.component.scss`

- [ ] **Step 1: Replace side-stripe cards with background tints (finding #2)**

Find the priority modifier blocks inside `.tip-card`:
```scss
&.priority-high   { border-left: 3px solid var(--expense); }
&.priority-medium { border-left: 3px solid #f59e0b; }
&.priority-low    { border-left: 3px solid var(--income); }
```

Replace with:
```scss
&.priority-high   { background: var(--color-expense-subtle); }
&.priority-medium { background: var(--color-warning-subtle); }
&.priority-low    { background: var(--color-income-subtle); }
```

- [ ] **Step 2: Replace #f59e0b with var(--color-warning) (finding #4)**

Find in `.priority-badge`:
```scss
.priority-medium & { background: rgba(245,158,11,0.15);  color: #f59e0b; }
```

Replace with:
```scss
.priority-medium & { background: rgba(245,158,11,0.15);  color: var(--color-warning); }
```

Also find the `border-left` reference you just replaced in Step 1 — already handled.

- [ ] **Step 3: Break the 3-column grid symmetry (finding #7)**

Find the `.tips-grid` block:
```scss
.tips-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px;
}
```

Add one rule after the closing `}` of `.tips-grid`:
```scss
// Priority-high cards span 2 columns — breaks equal-column lock (finding #7)
.tip-card.priority-high {
  grid-column: span 2;
}
```

- [ ] **Step 4: Replace dark hover shadow with lightness elevation (finding #10)**

Find `.tip-card:hover`:
```scss
&:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
```

Replace with:
```scss
&:hover,
&:focus-visible {
  background: var(--color-paper-3);
  outline: none;
}
```

Note: The `&.priority-*` background tints (added in Step 1) are more specific than this hover rule, so they won't be overridden when a priority card is hovered. Verify after build.

- [ ] **Step 5: Fix h1 font-size (finding #8)**

Find in `.tips-page`:
```scss
h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
```

Replace `font-size: 1.5rem` with `font-size: var(--text-page-title)`.

- [ ] **Step 6: Add :focus-visible to .refresh-btn (finding #5)**

Find `.refresh-btn`:
```scss
.refresh-btn {
  ...
  &:disabled { opacity: 0.5; cursor: default; }
  &:not(:disabled):hover { opacity: 0.85; }
  ...
}
```

Add inside the `.refresh-btn` block:
```scss
&:not(:disabled):focus-visible {
  opacity: 0.85;
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 7: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build. Check anyComponentStyle budget — tips.component.scss should still be under 8kB.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/pages/tips/tips.component.scss
git commit -m "fix(web/tips): close 6 audit findings

#2: Replace border-left side-stripes with background tints.
#4: #f59e0b -> var(--color-warning).
#5: :focus-visible on refresh-btn.
#7: .priority-high { grid-column: span 2 } breaks 3-col lock.
#8: h1 -> var(--text-page-title).
#10: hover lightness elevation replaces dark shadow."
```

---

## Task 8: Transactions page

**Findings closed:** #1 (3x font-family literals), #5 (focus-visible on 5 interactive elements)

**Files:**
- Modify: `web/src/app/pages/transactions/transactions.component.scss`

- [ ] **Step 1: Remove inline font-family declarations (finding #1)**

Find and replace all three occurrences of `font-family: 'Inter', sans-serif` in this file:

Line ~33 (`.search-input`):
```scss
font-family: 'Inter', sans-serif;
```
→ `font-family: var(--font-body);`

Line ~62 (`.filter-select`):
```scss
font-family: 'Inter', sans-serif;
```
→ `font-family: var(--font-body);`

Line ~110 (`.export-btn`):
```scss
font-family: 'Inter', sans-serif;
```
→ `font-family: var(--font-body);`

- [ ] **Step 2: Upgrade :focus to :focus-visible on form elements (finding #5)**

Find `.search-input`:
```scss
&:focus { border-color: var(--accent); }
```
→ `&:focus-visible { border-color: var(--color-accent); outline: 2px solid var(--color-focus); outline-offset: -1px; }`

Find `.filter-select`:
```scss
&:focus { border-color: var(--accent); }
```
→ `&:focus-visible { border-color: var(--color-accent); outline: 2px solid var(--color-focus); outline-offset: -1px; }`

Find `.filter-date`:
```scss
&:focus { border-color: var(--accent); }
```
→ `&:focus-visible { border-color: var(--color-accent); outline: 2px solid var(--color-focus); outline-offset: -1px; }`

- [ ] **Step 3: Add :focus-visible to .export-btn and .load-more-btn (finding #5)**

Find `.export-btn`:
```scss
&:hover { opacity: 0.85; }
```
Add after: `&:focus-visible { opacity: 0.85; outline: 2px solid var(--color-focus); outline-offset: 2px; }`

Find `.load-more-btn`:
```scss
&:hover:not(:disabled) { background: rgba(255,255,255,0.04); color: var(--text); }
```
Add after: `&:focus-visible:not(:disabled) { background: rgba(255,255,255,0.04); color: var(--color-ink); outline: 2px solid var(--color-focus); outline-offset: 2px; }`

- [ ] **Step 4: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/pages/transactions/transactions.component.scss
git commit -m "fix(web/transactions): font-family tokens + focus-visible

#1: 3x 'Inter' literal -> var(--font-body).
#5: :focus -> :focus-visible on search, filter-select, filter-date;
    :focus-visible added to export-btn and load-more-btn."
```

---

## Task 9: Compare page

**Findings closed:** #1 (font-family literal), #5 (focus-visible), #6 (tabular-nums), #8 (h1 scale)

**Files:**
- Modify: `web/src/app/pages/compare/compare.component.scss`

- [ ] **Step 1: Remove font-family literal from .picker-select (finding #1)**

Find `.picker-select`:
```scss
font-family: 'Inter', sans-serif;
```
→ `font-family: var(--font-body);`

- [ ] **Step 2: Fix h1 font-size (finding #8)**

Find `.cp-header h1`:
```scss
h1 { font-size: 1.75rem; font-weight: 700; color: var(--text); margin: 0 0 4px; }
```
Replace `font-size: 1.75rem` with `font-size: var(--text-page-title)`.

- [ ] **Step 3: Add tabular-nums to .stat-value (finding #6)**

Find `.stat-value`:
```scss
.stat-value {
  font-size: 0.95rem;
  font-weight: 700;
  &.income  { color: var(--income); }
  &.expense { color: var(--expense); }
}
```
Add `font-variant-numeric: tabular-nums;` as first property.

- [ ] **Step 4: Upgrade :focus-visible on .picker-select (finding #5)**

Find `.picker-select`:
```scss
&:focus { border-color: var(--accent); }
```
→ `&:focus-visible { border-color: var(--color-accent); outline: 2px solid var(--color-focus); outline-offset: -1px; }`

- [ ] **Step 5: Add :focus-visible to .compare-btn and .retry-btn (finding #5)**

Find `.compare-btn:hover`:
```scss
&:hover:not(:disabled) { opacity: 0.85; }
```
Add after: `&:focus-visible:not(:disabled) { opacity: 0.85; outline: 2px solid var(--color-focus); outline-offset: 2px; }`

Find `.retry-btn:hover`:
```scss
&:hover { opacity: 0.85; }
```
Add after: `&:focus-visible { opacity: 0.85; outline: 2px solid var(--color-focus); outline-offset: 2px; }`

- [ ] **Step 6: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/pages/compare/compare.component.scss
git commit -m "fix(web/compare): font-family, h1 scale, tabular-nums, focus-visible

#1: 'Inter' literal -> var(--font-body) in picker-select.
#5: :focus-visible on picker-select, compare-btn, retry-btn.
#6: tabular-nums on .stat-value.
#8: h1 -> var(--text-page-title)."
```

---

## Task 10: Recurring page

**Findings closed:** #4 (raw #60a5fa hex), #5 (focus-visible), #6 (tabular-nums), #8 (h1 scale)

**Files:**
- Modify: `web/src/app/pages/recurring/recurring.component.scss`

- [ ] **Step 1: Replace #60a5fa with token (finding #4)**

Find `.days-badge.today`:
```scss
&.today {
  background: rgba(59,130,246,0.15);
  color: #60a5fa;
}
```

Replace with:
```scss
&.today {
  background: var(--color-accent-subtle);
  color: var(--color-accent-light);
}
```

- [ ] **Step 2: Fix h1 font-size (finding #8)**

Find `.rp-header h1`:
```scss
h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 4px;
}
```
Replace `font-size: 1.75rem` with `font-size: var(--text-page-title)`.

- [ ] **Step 3: Add :focus-visible to .retry-btn (finding #5)**

Find `.retry-btn:hover`:
```scss
&:hover { opacity: 0.85; }
```
Add after: `&:focus-visible { opacity: 0.85; outline: 2px solid var(--color-focus); outline-offset: 2px; }`

- [ ] **Step 4: Add tabular-nums to financial display classes (finding #6)**

Add `font-variant-numeric: tabular-nums` to each of these classes:

`.sc-amount`:
```scss
.sc-amount {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums; // finding #6
  ...
}
```

`.upcoming-amount`:
```scss
.upcoming-amount {
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums; // finding #6
  ...
}
```

`.billed-amount`:
```scss
.billed-amount {
  font-size: 0.875rem;
  font-weight: 700;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums; // finding #6
  ...
}
```

`.row-amount`:
```scss
.row-amount {
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums; // finding #6
  ...
}
```

- [ ] **Step 5: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/pages/recurring/recurring.component.scss
git commit -m "fix(web/recurring): raw hex, h1 scale, tabular-nums, focus-visible

#4: #60a5fa -> var(--color-accent-light); rgba(59,130,246,0.15) -> var(--color-accent-subtle).
#5: :focus-visible on retry-btn.
#6: tabular-nums on sc-amount, upcoming-amount, billed-amount, row-amount.
#8: h1 -> var(--text-page-title)."
```

---

## Task 11: Budget page

**Findings closed:** #6 (tabular-nums), #9 (inline style removed)

**Files:**
- Modify: `web/src/app/pages/budget/budget.component.html`
- Modify: `web/src/app/pages/budget/budget.component.scss`

- [ ] **Step 1: Remove inline style from template (finding #9)**

Open `web/src/app/pages/budget/budget.component.html`. Find:
```html
<div class="section-header" style="margin-top:24px;">
```

Replace with:
```html
<div class="section-header section-header--budget-gap">
```

- [ ] **Step 2: Add CSS class for that spacing (finding #9)**

Open `web/src/app/pages/budget/budget.component.scss`. At the end of the file, add:
```scss
// Spacing for the category breakdown section header (replaces inline style — finding #9)
.section-header--budget-gap {
  margin-top: var(--space-lg);
}
```

- [ ] **Step 3: Add tabular-nums to financial display classes (finding #6)**

In `budget.component.scss`, find `.hero-amount`:
```scss
.hero-amount {
  font-size: 2.6rem;
  font-weight: 700;
  letter-spacing: -1.5px;
  margin-bottom: 14px;
  ...
}
```
Add `font-variant-numeric: tabular-nums;` as first property.

Find `.cbc-budget-label .cbc-budget-amount`:
```scss
.cbc-budget-amount { font-size: 0.95rem; font-weight: 600; }
```
Add `font-variant-numeric: tabular-nums;` to `.cbc-budget-amount`.

- [ ] **Step 4: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/pages/budget/budget.component.html \
        web/src/app/pages/budget/budget.component.scss
git commit -m "fix(web/budget): inline style -> CSS class, tabular-nums

#6: tabular-nums on hero-amount, cbc-budget-amount.
#9: style='margin-top:24px' -> .section-header--budget-gap CSS class."
```

---

## Task 12: Analytics page

**Findings closed:** #5 (focus-visible + keyboard on table rows), #6 (tabular-nums), #8 (h1 scale)

**Files:**
- Modify: `web/src/app/pages/analytics/analytics.component.scss`
- Modify: `web/src/app/pages/analytics/analytics.component.html`

- [ ] **Step 1: Fix h1 font-size (finding #8)**

In `analytics.component.scss`, find `.an-header h1`:
```scss
h1 { font-size: 1.75rem; font-weight: 700; color: var(--text); margin: 0 0 4px; }
```
Replace `font-size: 1.75rem` with `font-size: var(--text-page-title)`.

- [ ] **Step 2: Add tabular-nums to financial classes (finding #6)**

Find `.tx-amount`:
```scss
.tx-amount { font-size: 0.9rem; font-weight: 700; color: var(--text); }
```
Add `font-variant-numeric: tabular-nums;`.

Find `.tx-count`:
```scss
.tx-count  { font-size: 0.875rem; color: var(--text-muted); }
```
Add `font-variant-numeric: tabular-nums;`.

- [ ] **Step 3: Add :focus-visible to .table-row (finding #5)**

Find `.table-row` in `analytics.component.scss`. It currently has:
```scss
.table-row {
  ...
  cursor: pointer;
  transition: background 0.13s;
  &:last-child { border-bottom: none; }
  &:hover      { background: rgba(255,255,255,0.025); }
  &.active { ... }
}
```

Add after `&:hover`:
```scss
&:focus-visible {
  background: rgba(255,255,255,0.025);
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}
```

- [ ] **Step 4: Add tabindex and keyboard handlers to table rows in template (finding #5)**

Open `analytics.component.html`. Find the `.table-row` element inside `@for`:
```html
<div class="table-row"
     [class.active]="selectedName === item.name"
     (click)="selectTransaction(item.name)">
```

Replace with:
```html
<div class="table-row"
     [class.active]="selectedName === item.name"
     (click)="selectTransaction(item.name)"
     (keydown.enter)="selectTransaction(item.name)"
     (keydown.space)="$event.preventDefault(); selectTransaction(item.name)"
     tabindex="0"
     role="row"
     [attr.aria-selected]="selectedName === item.name">
```

Note: `$event.preventDefault()` on Space prevents the page from scrolling when the user presses Space.

- [ ] **Step 5: Verify build passes**

```bash
cd web && pnpm run build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/pages/analytics/analytics.component.scss \
        web/src/app/pages/analytics/analytics.component.html
git commit -m "fix(web/analytics): h1 scale, tabular-nums, keyboard nav on rows

#5: tabindex + keydown.enter/space on .table-row for keyboard navigation;
    :focus-visible ring on focused row.
#6: tabular-nums on tx-amount, tx-count.
#8: h1 -> var(--text-page-title)."
```

---

## Task 13: Statistics page + final verification

**Findings closed:** #6 (tabular-nums — last page)

**Files:**
- Modify: `web/src/app/pages/statistics/statistics.component.scss`

- [ ] **Step 1: Add tabular-nums to financial classes (finding #6)**

In `statistics.component.scss`, find `.savings-rate`:
```scss
.savings-rate {
  font-size: 2.8rem;
  font-weight: 700;
  letter-spacing: -1.5px;
  margin: 4px 0;
  ...
}
```
Add `font-variant-numeric: tabular-nums;` as first property.

Find `.pill-val`:
```scss
.pill-val {
  font-size: 1.05rem;
  font-weight: 700;
  ...
}
```
Add `font-variant-numeric: tabular-nums;`.

- [ ] **Step 2: Commit statistics change**

```bash
git add web/src/app/pages/statistics/statistics.component.scss
git commit -m "fix(web/statistics): tabular-nums on savings-rate and pill-val

Closes finding #6 (last file)."
```

- [ ] **Step 3: Run final full build**

```bash
cd web && pnpm run build
```
Expected: clean build with no warnings or errors.

- [ ] **Step 4: Verify all 11 audit findings are closed**

Check each finding against the codebase:

| # | Finding | Where to verify |
|---|---|---|
| #1 | Inter-everywhere | `grep -r "font-family: 'Inter'" web/src/app` → only in index.html (CDN load) — no SCSS matches |
| #2 | Side-stripe card | `grep -r "border-left.*solid" web/src/app/pages/tips` → no matches |
| #3 | overflow-x clip | `grep "overflow-x" web/src/styles.scss` → shows `overflow-x: clip` |
| #4 | Raw hex outside tokens | `grep -r "#0a1120\|#60a5fa\|#f59e0b\|#f87171.*#fb923c" web/src/app` → no matches |
| #5 | Hover-only affordances | `grep -r "focus-visible" web/src/app` → 10+ matches across components |
| #6 | Tabular-nums | `grep -r "tabular-nums" web/src` → matches in styles.scss + 5 component files |
| #7 | 3-col grid | `grep "grid-column: span" web/src/app/pages/tips` → shows `span 2` |
| #8 | h1 inconsistency | `grep -r "font-size: 1\." web/src/app/pages` → only `text-page-title` token refs remain |
| #9 | Inline style | `grep -r 'style="margin-top' web/src/app/pages/budget` → no matches |
| #10 | Dark shadow | `grep "box-shadow" web/src/app/pages/tips` → no matches |
| #11 | page-wrap centering | `grep "margin-inline" web/src/styles.scss` → shows `margin-inline: auto` |

- [ ] **Step 5: Run grep checks**

```bash
cd web
echo "=== #1 Inter-everywhere (should be empty) ===" && grep -r "font-family: 'Inter'" src/app
echo "=== #2 Side-stripe (should be empty) ===" && grep -r "border-left.*solid" src/app/pages/tips
echo "=== #3 overflow-x ===" && grep "overflow-x" src/styles.scss
echo "=== #4 Raw hex (should be empty) ===" && grep -rE "#0a1120|#60a5fa|#f59e0b" src/app
echo "=== #5 focus-visible count ===" && grep -rc "focus-visible" src/app | grep -v ":0"
echo "=== #6 tabular-nums count ===" && grep -rc "tabular-nums" src | grep -v ":0"
echo "=== #7 grid span ===" && grep -r "grid-column.*span" src/app/pages/tips
echo "=== #9 inline style (should be empty) ===" && grep -r 'style="margin-top' src/app/pages/budget
echo "=== #10 box-shadow in tips (should be empty) ===" && grep "box-shadow" src/app/pages/tips/tips.component.scss
echo "=== #11 margin-inline ===" && grep "margin-inline" src/styles.scss
```

Expected output: each `should be empty` check returns nothing. Other checks return matches.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(web): hallmark redesign complete — all 11 findings closed

Critical: #1 Inter-everywhere, #2 side-stripe card, #3 overflow-x clip
Major:    #4 raw hex tokens, #5 hover-only affordances,
          #6 tabular-nums, #7 tips 3-col grid
Minor:    #8 h1 scale, #9 inline style, #10 dark shadow, #11 page-wrap center

18 files modified/created. 0 deletions. 0 route changes.
Design system locked in web/design.md + web/src/tokens.css."
```

---

## Success Criteria

All must pass before the plan is considered complete:

- [ ] `pnpm run build` exits 0 with no errors
- [ ] All 11 grep checks in Task 13 Step 5 return expected results
- [ ] Mobile drawer works at 375px (hamburger visible, sidebar slides, closes on navigate)
- [ ] Tab through the nav sidebar — each item shows a visible cyan focus ring
- [ ] Currency values in Dashboard stat cards align vertically (tabular-nums)
- [ ] Tips page at 1200px viewport: first high-priority card is wider than adjacent card
- [ ] No tip card has a left-side colored stripe

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

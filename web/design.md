# Design — AccBot Web

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Direction

"Instrument" — dense, data-first, one amber accent. A top bar (brand, primary
nav, nav groups, notifications, settings) replaces the old sidebar; on narrow
screens the bar collapses to brand + notifications + a menu toggle that opens
a full-screen sheet.

## Theme

Dark and light, switchable in Settings -> Appearance (System/Dark/Light) and
kept in `localStorage`. All tokens live in `src/tokens.css`, as plain hex
colours with a light-theme override block per token, not a single value that
adapts by formula.

- `--surface` / `--surface-raised` / `--surface-overlay` — page, panel and
  overlay backgrounds
- `--line` / `--line-strong` / `--line-control` — hairline rules, stronger
  dividers, and input/select/textarea borders (the only one guaranteed >= 3:1
  against `--surface-raised`, which the other two are not)
- `--ink` / `--ink-2` / `--ink-3` — body text, supporting text (>= 4.5:1) and
  placeholders/captions (also >= 4.5:1 as of this pass — see the contrast
  note below)
- `--accent` / `--accent-ink` — the one amber. `--accent` is for fills and
  backgrounds; `--accent-ink` is for text and icon glyphs, since the amber
  fill itself falls short of 4.5:1 against light-theme surfaces
- `--pos` / `--neg` / `--warn` and their `*-wash` backgrounds — income,
  expense and warning data colours
- `--focus` — the focus ring colour

A handful of pre-redesign token names (`--bg`, `--color-accent`, `--radius-sm`,
...) remain as aliases of the tokens above, so pages not yet touched keep
working; new code should reach for the tokens listed here instead.

## Typography

- Sans: Outfit (variable) — everything except tabular figures
- Mono: JetBrains Mono (variable) — amounts and other tabular numbers
  (`.num`, `.figure`)

Font tokens: `--font-sans`, `--font-mono`.

## Icons

Tabler outline icons, bundled per-name (not the whole set) via `app-icon`
(`core/ui/icon/`). Each name resolves to one sanitized `SafeHtml`, cached
per name at module scope, so repeated renders of the same icon share one
object identity — required for `[innerHTML]` and OnPush/Eager change
detection to leave the DOM node alone between checks.

## Spacing

4-point named scale, `--space-3xs` (0.25rem) through `--space-2xl` (4.5rem).
Pages should use named tokens (`var(--space-md)`), not raw values.

## Radius

Three system radii, plus one hairline exception:

- `--radius-panel` (12px) — cards, panels, the phone sheet
- `--radius-control` (8px) — buttons, inputs, menu items, the top bar's pill
  controls
- `--radius-tag` (6px) — tags, badges, the notification bar
- `--radius-mark` (2px) — small square marks only (category swatches/dots,
  the active nav tab's bottom corners): anything that would read as a circle
  at the radii above

## Layout

- `.page` / `.page-title` (and the older `.page-wrap` / `.page-header`
  aliases) — the page shell
- `.tiles` / `.tile` (and `.stat-grid` / `.stat-card`) — a 1px line grid
  instead of bordered cards, for stat rows
- `.card` — a bordered panel for everything else

## Motion

`var(--dur-short)` / `var(--dur-base)` with `var(--ease-out)`. Under
`prefers-reduced-motion: reduce`, CSS transitions collapse to ~0ms and Chart.js
animations are turned off globally (see `core/ui/chart-theme.ts`).

## Accessibility

- Focus-visible on every interactive element: `outline: 2px solid var(--focus); outline-offset: 2px` (tighter offsets for menu items and inputs — see `_primitives.scss`)
- Category colour is never the only signal on text: a small square swatch
  carries the colour, the label itself renders in `var(--ink)`
- Sentence case throughout; no all-caps or letter-spaced labels

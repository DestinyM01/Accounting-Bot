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
adapts by formula. There are no compatibility aliases any more (removed in
stage 4) — every stylesheet and every TS read (`getComputedStyle(...)
.getPropertyValue('--x')`, e.g. `core/ui/chart-theme.ts`) uses the tokens
below by their real names.

- `--surface` / `--surface-raised` / `--surface-overlay` — page, panel and
  overlay backgrounds
- `--line` / `--line-strong` / `--line-control` — hairline rules, stronger
  dividers, and input/select/textarea borders (the only one guaranteed >= 3:1
  against `--surface-raised`, which the other two are not)
- `--ink` / `--ink-2` / `--ink-3` — body text, supporting text (>= 4.5:1) and
  placeholders/captions (also >= 4.5:1 against `--surface` / `--surface-raised`
  / `--surface-overlay` in both themes)
- `--accent` / `--accent-ink` / `--accent-wash` / `--on-accent` — the one
  amber. `--accent` is for fills and backgrounds; `--accent-ink` is for text
  and icon glyphs, since the amber fill itself falls short of 4.5:1 against
  light-theme surfaces; `--accent-wash` is the selected/hover tint;
  `--on-accent` is text/icons drawn on top of an `--accent` fill
- `--pos` / `--neg` / `--warn` and their `*-wash` backgrounds — income,
  expense and warning data colours
- `--focus` — the focus ring colour
- `--shadow-menu` / `--scrim` — the menu drop shadow and the phone sheet's
  backdrop

Category colours are the one deliberate exception to "tokens only": built-in
category colours and the unknown-category fallback (`CategoryService`, `#8b95a3`
— the palette's "other" swatch) are categorical data colours, not UI tokens,
and custom category colours come straight from the api's palette.

## Typography

- Sans: Outfit (variable) — everything except tabular figures
- Mono: JetBrains Mono (variable) — amounts and other tabular numbers
  (`.num`, `.figure-lg` / `.figure-md` / `.figure-sm`)

Font tokens: `--font-sans`, `--font-mono`. There is no separate "display"
font — headings use `--font-sans` too.

## Icons

Tabler outline icons, bundled per-name (not the whole set) via `app-icon`
(`core/ui/icon/`). Each name resolves to one sanitized `SafeHtml`, cached
per name at module scope, so repeated renders of the same icon share one
object identity — required for `[innerHTML]` and OnPush/Eager change
detection to leave the DOM node alone between checks. An ancestor rule can
still resize the glyph directly (e.g. `.txl-icon app-icon { width: 16px }`
in `transactions.component.scss`); the host's own `--icon-size` var only
sets the fallback used when nothing overrides it.

## Spacing

4-point named scale, `--space-3xs` (0.25rem) through `--space-2xl` (4.5rem).
Pages should use named tokens (`var(--space-md)`), not raw values.

## Radius

Three system radii, plus one hairline exception. These are the only radius
values used anywhere in `web/src` outside `tokens.css` itself (a bare
`border-radius: 0`, used a couple of places to reset a native `<button>`'s
own shape rather than to pick one, is not a competing radius choice):

- `--radius-panel` (12px) — cards, panels, the phone sheet
- `--radius-control` (8px) — buttons, inputs, menu items, the top bar's pill
  controls
- `--radius-tag` (6px) — tags, badges, the notification bar
- `--radius-mark` (2px) — small square marks only (category swatches/dots,
  the active nav tab's bottom corners): anything that would read as a circle
  at the radii above

## Layout and primitives (global SCSS: `styles.scss` + `styles/*.scss`)

`styles.scss` holds only what's still shared and not already in a primitive:
`.card` (a bordered panel — the one surface that isn't a `.tiles` grid) and
`.section-header` (an h2 + optional right-aligned link, `justify-content:
space-between`). Everything else lives in `styles/_primitives.scss` (global
on purpose — see the comment at its top: a per-component `@use` would
re-emit these rules into every component stylesheet and blow the 10 kB
component style budget for nothing) or `styles/_shell.scss` (the top bar,
its menus, and the phone sheet — kept out of `app.component.scss` for the
same budget reason).

- **Layout:** `.page` (max-width 1320px, padding 28px 24px, 16px on phones)
  and `.page-title` (h1 + `.page-title-meta` sub, actions on the right,
  `justify-content: space-between`).
- **Tiles:** `.tiles` (a grid with `gap: 1px`, the line colour behind it,
  panel radius, overflow clip) and `.tile` (surface padding 20px 22px).
- **Text and numbers:** `.label` (13px `--ink-2`) and `.figure-lg` /
  `.figure-md` / `.figure-sm` (mono, tabular, three sizes). `.pos` / `.neg`
  are text-colour modifiers for income/expense figures.
- **Buttons:** `.btn` (secondary) and its modifiers `.btn--primary` (amber
  fill), `.btn--ghost` (no border), `.btn--danger` (outlined `--neg`),
  `.btn--icon` (34px square, transparent). Hover, active (`scale(0.98)`),
  focus-visible and `[disabled]` states are all defined once. `a.btn` gets
  its own `text-decoration: none` (a link acting as a button, e.g. "Go to
  Dashboard" on Not-found), so no page has to reset it locally.
- **Segmented control and chips:** `.seg` / `.seg-opt` (a roving-tabindex
  radio group, e.g. Appearance's Dark/Light/System) and `.chip`
  (`aria-pressed` toggle, e.g. a filter pill).
- **Fields:** `.field` (label above the input, helper text below via
  `.field-hint` / `.field-error`), plus shared `input` / `select` /
  `textarea` styling for both themes.
- **Tags and marks:** `.tag` (square-ish; `--pos` / `--neg` / `--warn` /
  `--accent` tint modifiers) and `.swatch` (the 8px category-colour square —
  colour is never the only signal on category text).
- **Rows:** `.rows` / `.row` for dense lists, one hairline between rows.
- **States:** `.skeleton` (a block with a subtle shimmer, static under
  `prefers-reduced-motion: reduce`) with `.skel-line` / `.skel-figure` size
  modifiers; `.empty` (headline, one line, one action); `.error-inline`
  (icon + message, `--neg`).
- **Overlays:** `.menu` for dropdowns (overlay surface, control radius, soft
  tinted shadow) and `.sheet` for the phone menu.
- **Misc:** `.sr-only` (visually hidden, still announced).

## Shell (`app.component.*` + `styles/_shell.scss`)

A sticky top bar (`.shell-bar`, 64px, blurred translucent background) with
three zones: brand on the left, centered nav + "Insights"/"Manage" menus in
the middle, notifications + Settings gear on the right. Below 900px the
center nav and the gear disappear; a phone toggle opens a full-height sheet
(`.shell-sheet`) listing every page grouped the same way, with a scrim
behind it. Only the phone sheet traps focus (Tab and Shift+Tab cycle
through the toggle and the sheet's own links and buttons); the dropdown menus move focus to their
first item and step through items with the arrow keys. Menus and the sheet
both close on Escape and on an outside click, and every open control is a
real `button`/`a` with visible focus rings.

**The minimal bar:** while the route is `/not-allowed`, `.shell-bar-inner`
gets the `--minimal` modifier instead: the brand on the left (plain text,
not a link, since every page it could lead to is refused too), "Log out" on
the right, nothing else (no nav, no notifications, no FAB). This is the
403 dead end for a signed-in user whose account isn't the owner's: any
`/api` call answering 403 makes `authInterceptor` navigate to
`/not-allowed`. Its module-level flag only suppresses duplicate redirects
from 403s that arrive while that navigation runs, and is cleared once it
settles, so leaving the page (Back, a typed url) and hitting another 403
redirects again. When the app starts on `/not-allowed` (a refresh there),
`categoryService.load()` is skipped: the shell seeds its current url from
`Location.path()` rather than waiting for the first navigation, so it also
shows the minimal bar from the first paint.

**Not-found** (`path: '**'`, last in `app.routes.ts`) is an ordinary `.page`
behind the same `authGuard` as every other route — it's a normal signed-in
dead end for a bad URL, not an auth state, so it keeps the full shell.

## States

Every page-level list or figure has three states beyond its happy path:

- **Skeleton:** shapes matching the eventual content (`.skeleton` blocks,
  sized with `.skel-line` / `.skel-figure` or an inline `--w`), not a bare
  "Loading…" string.
- **Empty:** `.empty`: one line saying there's nothing yet, optionally a
  second line on how to get some (e.g. Merchants' "Confirm a category on the
  Transactions page and the merchant shows up here."), plus the one action
  that would change that (e.g. "New category"). A 503/no-data case (like
  Tips' "AI tips unavailable") reuses `.empty` too.
- **Error:** `.error-inline` next to whatever failed, with a "Try again"
  `.btn` where a reload can fix it. Never `alert()`.

## Preview mode (dev-only, committed)

A build configuration, `preview` (`ng build --configuration preview`, served
on `127.0.0.1:4399`), that runs the whole app on sample data so any page can
be screenshotted and clicked through without Authentik or the api:

- `src/preview/app.config.preview.ts` swaps in `previewApiInterceptor` and a
  `fakeOAuth` (`hasValidAccessToken` always true, claims `{ name: 'Sample
  Owner', sub: '00000000-sample-owner-id' }`, `logOut` / `initCodeFlow`
  no-ops) via `fileReplacements`, so the real `OAuthService` and api are
  never touched.
- `src/preview/preview-api.interceptor.ts` + `fixtures.ts` answer every
  `/api/...` call `ApiService` makes with realistic, obviously-fake data
  and keep state in memory (creating/editing/deleting a transaction moves
  the balance). Unknown paths answer 404 with a console warning.
- **Dev-only switch:** setting `localStorage['accbot.preview.forbid'] = '1'`
  makes every `/api` call answer 403, so the Not-allowed flow (normally only
  reachable for a non-owner account) can be screenshotted too. It has no
  effect outside the preview build.
- **Never in production:** `ng build` (production) never includes
  `src/preview/`, since it's only reachable through the replacement above.
- **PII:** the fixtures contain no real names, accounts or amounts (the repo
  is public).

## Motion

`var(--dur-short)` / `var(--dur-base)` with `var(--ease-out)`. Under
`prefers-reduced-motion: reduce`, CSS transitions collapse to ~0ms and Chart.js
animations are turned off globally (see `core/ui/chart-theme.ts`).

## Accessibility

- Focus-visible on every interactive element: `outline: 2px solid var(--focus); outline-offset: 2px` (tighter offsets for menu items and inputs — see `_primitives.scss`)
- Category colour is never the only signal on text: a small square swatch
  carries the colour, the label itself renders in `var(--ink)`
- A grid of icon-only or colour-only choices (e.g. Categories' emoji and
  colour pickers) gets a visible caption above it plus `role="group"
  aria-labelledby="…"` pointing at that caption, not just an invisible
  `aria-label`
- Sentence case throughout; no all-caps or letter-spaced labels; zero em or
  en dashes in visible text
- 40px touch targets at 760px and below: buttons, inputs, selects, chips and
  `role=radio` segment options through `_primitives.scss`'s phone media
  query, the shell's own controls through `_shell.scss`'s, and inline links
  (Settings' `.set-link`, the dashboard's `.dash-all-link`) in their own
  stylesheets. The Settings `role=switch` gets its 40px hit area from
  `settings-section.scss`, at every width.

## How to add a page

1. Add the route in `app.routes.ts` (lazy `loadComponent`, `canActivate:
   [authGuard]`), and a nav entry in `app.component.html` (top bar + phone
   sheet) if it should be reachable from navigation.
2. Template: `<div class="page">` with a `.page-title` (h1 + `.page-title-meta`
   sub, actions on the right), then one or more `.card`s or a `.tiles` row.
   Reuse `.rows`/`.row`, `.field`, `.tag`, `.swatch`, `.btn*` from the
   primitives rather than inventing new markup for something they already
   cover.
3. Cover all three states for anything loaded from the api: a skeleton
   shaped like the content, an `.empty` message with an action, and
   `.error-inline` plus "Try again".
4. Only tokens for colour and radius; category colours are the one
   exception. Numbers are mono (`.num` / `.figure-*`). Sentence case, zero
   em/en dashes.
5. `changeDetection: ChangeDetectionStrategy.Eager`, and keep the
   component's own `.scss` under the 10 kB warning budget — move anything
   that's genuinely shared into a global partial instead of raising it.
6. Add it to the preview fixtures (`src/preview/fixtures.ts` +
   `preview-api.interceptor.ts`) if it needs its own sample data, then check
   it at 1280/1024/900/600/390 in both themes before calling it done.

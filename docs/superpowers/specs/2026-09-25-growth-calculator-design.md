# Growth Calculator — Design Spec (migration sub-project 8, the last)

**Goal:** A web page that shows how savings grow with compound interest, from a starting amount and a monthly deposit, year by year. One click fills it with the user's own numbers.

**Context:**
- **What the bot had.** A "compound interest" scene: the user typed `amount, rate, years` and got one number. It computed the future value of monthly deposits with monthly compounding, with no starting amount and no breakdown.
- **Its bugs.**
  - Its help text told the user to type `amount, years, rate` (`1000, 10, 15` meaning 10 years at 15%), but the code read `amount, rate, years`, so that example computed 10% for 15 years.
  - It refused a 0% rate, because its formula divided by the rate.
- **Everything else has moved to the web.** This is the last item of the migration.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Starting amount, monthly deposit, rate, years; final balance, put-in vs interest, a yearly chart and table; "Use my numbers"** | The user's choice. |
| Placement | **Its own page**, "Growth calculator" in the sidebar between Tips and Settings | The user's choice. |
| Where the math runs | **In the api, as a pure tested function**; the page calls it | The web has no test runner; math that must be right lives where it can be tested (the Balance page's precedent). "Use my numbers" needs the api anyway. |
| Compounding | **Monthly, at `rate / 12`**; each deposit **at the end of its month**; the starting amount earns interest from month 1 | The bot's convention (ordinary annuity), now with a starting amount. |
| 0% | **Allowed** | The month-by-month computation has no division by the rate. |
| "My numbers" | **Starting amount:** the current balance, or 0 if negative. **Monthly deposit:** the average net (income − spending) of the **last 3 complete calendar months**, computed the way Statistics does, or 0 if that is ≤ 0 | Real, explainable inputs; transfers between own accounts are excluded as everywhere else. |

---

## API (`api/src/calculator/`)

### `compoundGrowth(input)` in `compound-growth.ts`

A pure function.

```ts
export interface GrowthInput { start: number; monthly: number; rate: number; years: number }
export interface GrowthYear { year: number; balance: number; putIn: number; interest: number }
export interface GrowthResult { finalBalance: number; putIn: number; interest: number; years: GrowthYear[] }
```

For each month m = 1…12·years:
```
balance = balance · (1 + rate/100/12) + monthly
```
Here `balance` starts at `start`. At the end of each year, a row records:
- `balance` (rounded to cents);
- `putIn = start + monthly · 12 · year`;
- `interest = balance − putIn` (rounded).

The final figures are the last row's. Rounding happens only on output; the running balance keeps full precision.

### `GET /calculator/compound?start=&monthly=&rate=&years=`

Every failure is a 400 with a message.

| Parameter | Rule |
|---|---|
| `start`, `monthly` | numbers ≥ 0 and ≤ 1e12; at least one > 0 |
| `rate` | a number from 0 to 100 |
| `years` | a whole number from 1 to 60 |

It returns the `GrowthResult`.

### `GET /calculator/my-numbers`

```ts
{
  startingAmount: number;      // max(0, the Balance document's balance), rounded; 0 when there is none
  monthlySavings: number;      // max(0, average net of the 3 months), rounded
  spentMore: boolean;          // true when that average was ≤ 0 and at least one month had activity
  months: { month: number; year: number; income: number; expense: number; net: number }[];  // oldest first
}
```

- **The months** are the 3 complete calendar months before the current one, in server-local time like Statistics, through `StatisticsService.summary(month, year)`.
- **The balance** comes from the `Balance` document (a read-only query; `BalanceModule` doesn't export its service).
- **Wiring.** `CalculatorModule` imports `StatisticsModule` and registers the `Balance` model. `CalculatorController` has the class-level `JwtAuthGuard`, pinned in the guard table.

---

## Web (`/calculator`)

- **Route and nav.** A lazy route `/calculator`, and `{ label: 'Growth calculator', icon: 'savings', path: '/calculator' }` between Tips and Settings.

### Inputs
- **Four labelled number fields** with units: **Starting amount** ($), **Monthly deposit** ($), **Annual rate** (%) and **Years**.
  - Initial values: 0, 1,000, 10 and 15. That is the bot's example with its intended meaning.
  - `min`/`step` attributes: 0.01 for money, 0.1 for the rate, 1 for years.
- **Use my numbers** (`.fc-btn--ghost`) fills in the starting amount and the monthly deposit from `/calculator/my-numbers`.
  - Under it, an `aria-live="polite"` note: "Your balance today · average saved over {Mon}–{Mon}: {amount}". When `spentMore` is true, it says "…you spent more than you earned, so {0}".
  - A failure shows inline and leaves the fields untouched.
- **Recalculation.** It updates ~300 ms after the last change.
  - A request counter drops stale replies.
  - An invalid combination, or a 400, shows the message inline (`role="alert"`) and keeps the last good result on screen, marked as out of date with a muted line: "Showing the last valid result".

### Results
- **Three figures:** **Final balance**, **You put in** and **Interest earned**, in one `aria-live="polite"` region.
- **The chart:** a Chart.js stacked bar chart, one bar per year, split into what was put in and the interest.
  - Colours are read from theme tokens with `getComputedStyle`: `--text-muted` for put-in, `--accent` for interest, `--border` for the grid.
  - It is destroyed on component destroy, and rebuilt without animation when the result changes.
  - It carries `role="img"` and an `aria-label` summary: "After {N} years: {final} — {putIn} put in, {interest} interest".
- **The table:** **Show the table** / **Hide the table** (`aria-expanded`) toggles a table with the columns Year, Put in, Interest and Balance. At phone width it scrolls inside its own box.
- **Explainer:** three short lines on how compounding works, adapted from the bot's text.

### Behaviour and styling
- Money uses the web's existing `currency:'USD'` format, like every other page.
- Theme tokens only, and the shared form classes.
- At phone width the form stacks above the results, with no horizontal page scroll.

---

## Testing

Written first; each must fail before its implementation exists.

- **`compoundGrowth`:**
  - **0% rate:** balance = put-in, and interest is 0.
  - **Starting amount only:** $1,000 at 12% for 1 year = 1000 · 1.01¹² = $1,126.83.
  - **Deposits only:** $100/month at 12% for 1 year = 100 · (1.01¹² − 1) / 0.01 = $1,268.25.
  - **The bot's example with its intended meaning:** $1,000/month for 15 years at 10% — `finalBalance` equals the closed-form annuity value, rounded to cents.
  - **Rows:** one per year, `putIn` exact.
  - **Rounding** only on output.
- **The controller or service validation:** every rule above, 400 each, including "both amounts 0", 61 years, 2.5 years, 101%, −1 and non-numbers.
- **`my-numbers`:**
  - the three month calls (with year wrap, for example from January);
  - averaging, and rounding;
  - a negative average gives 0 with `spentMore`;
  - a negative balance gives 0;
  - no Balance document gives 0;
  - no activity at all gives `spentMore: false`.
- **The guard:** `CalculatorController` in the class-level guard table.
- **Web:** `pnpm run build` clean with zero warnings; no colour literals; a preview-harness screenshot at desktop and phone width.

---

## Out of scope

- Inflation, taxes, varying rates or deposits, and withdrawals.
- Saving scenarios.
- Linking to a real savings account.
- Currency beyond the app's existing `$` display.

---

## Spec self-review

**Placeholders:** none.

**Internal consistency:**
- The compounding rule, the test figures and the explainer describe the same convention (monthly compounding, deposits at month end).
- "My numbers" uses the Statistics definition of income and spending.

**Ambiguity resolved:**
- 0% is allowed.
- Years are whole numbers.
- The months are complete calendar months before the current one.
- A negative balance or a negative average becomes 0.
- The initial example reads the bot's example the way its help text meant it.

**Scope:** one page and two small endpoints. About 6 tasks.

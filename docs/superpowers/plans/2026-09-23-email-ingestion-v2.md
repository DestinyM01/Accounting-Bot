# Email Ingestion v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse every bank email format that carries real money, classify transfers by destination account so internal money movement never inflates expenses, and reconcile recurring rules against email so no payment is recorded twice.

**Architecture:** Both the BHD and Popular parsers become *dispatchers* — they discriminate on subject / `Tipo de transacción` first, then delegate to a format-specific routine. A shared `own-party.ts` decides whether a destination is one of the user's own cash accounts. A new `ReconciliationService` matches transactions against recurring rules in both directions.

**Tech Stack:** NestJS 10, Mongoose, Jest. `api/` uses **pnpm**, `repo/` uses **npm**.

**Spec:** `docs/superpowers/specs/2026-09-23-email-ingestion-v2-design.md`

---

## Critical context for the implementer

Read these before starting. Each one is a trap that has already bitten this codebase.

1. **`TransactionType` values are legacy Russian strings.** `api/src/shared/schemas/transaction-type.enum.ts` defines `INCOME = 'Доход'`, `EXPENSE = 'Расход'`. Always write `TransactionType.INCOME`, never `'income'`. A literal string makes rows invisible to every query that filters on the enum.

2. **Expenses are stored as negative `amount`.** `Math.abs()` before display. Income is positive.

3. **Test fixtures use synthetic values by design.** Names like `JUAN ANTONIO RIVERA MARTE` and accounts `2001/2002/2003` are not real. Do **not** replace them with anything that looks like a real account. Real identifiers live only in `OWN_CASH_ACCOUNTS` env config.

4. **Own-cash-account digits in tests are `2001`, `2002`, `2003`.** Near-miss non-own accounts are `2004` and `2007` — they differ from `2003` only in the last digit, which is exactly what the digit-boundary test exercises. Do not "tidy" these numbers.

5. **The schemas in `api/` and `repo/` back the same MongoDB collection.** Any field added to one must be added to the other or the bot and the API disagree about the same document.

6. **Never classify a transfer on its subject.** A real email reading `Tipo de transacción: Transacciones entre productos BHD y a otros Bancos` moved money between two of the user's own accounts. Only the parsed destination field decides.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `api/src/ingestion/parsers/own-party.ts` | `matchesOwn` — digit-boundary-safe identifier matching, shared by all parsers |
| `api/src/ingestion/parsers/own-party.spec.ts` | Its tests |
| `api/src/ingestion/parsers/bhd-transfer.parser.ts` | BHD pipe label/value transfer format |
| `api/src/ingestion/parsers/bhd-transfer.parser.spec.ts` | Its tests |
| `api/src/ingestion/parsers/popular-transfer.parser.ts` | Popular sent + received transfer formats |
| `api/src/ingestion/parsers/popular-transfer.parser.spec.ts` | Its tests |
| `api/src/ingestion/reconciliation.service.ts` | Matches a transaction against recurring rules |
| `api/src/ingestion/reconciliation.service.spec.ts` | Its tests |

**Modify:**

| File | Change |
|---|---|
| `api/src/ingestion/parsers/types.ts` | Add `transferKind`, `ownCashAccounts`, optional `isNonTransactional` |
| `api/src/ingestion/parsers/dates.ts` | Add `parseDdMmYyyyDash12h` |
| `api/src/ingestion/parsers/banreservas.parser.ts` | Import `matchesOwn` instead of defining it |
| `api/src/ingestion/parsers/bhd.parser.ts` | Become a dispatcher |
| `api/src/ingestion/parsers/popular.parser.ts` | Become a dispatcher, add known-skip list |
| `api/src/shared/schemas/transaction.schema.ts` | Add `transferKind`, `recurringId` |
| `repo/src/mongodb/schemas/transaction.schemas.ts` | Mirror the same two fields |
| `api/src/ingestion/ingestion.service.ts` | Honour `transferKind` and `isNonTransactional`; call reconciliation |
| `api/src/transactions/transactions.service.ts` | Exclude `internal`/`unresolved` from expense totals |
| `repo/src/service/recurring.service.ts` | Skip months already fulfilled; fix idempotency |

---

## Phase 1 — Parsers and classification

### Task 1: Extract `matchesOwn` into a shared module

**Files:**
- Create: `api/src/ingestion/parsers/own-party.ts`
- Create: `api/src/ingestion/parsers/own-party.spec.ts`
- Modify: `api/src/ingestion/parsers/banreservas.parser.ts:12-26`

- [ ] **Step 1: Write the failing test**

Create `api/src/ingestion/parsers/own-party.spec.ts`:

```typescript
import { matchesOwn } from './own-party';

describe('matchesOwn', () => {
  const own = ['2001', '2002', '2003', 'juan antonio rivera'];

  it('matches an account number on a digit boundary', () => {
    expect(matchesOwn('XXXXXXXXXX2003', own)).toBe(true);
  });

  // A plain substring test would report 32002 as our own account and silently
  // flip a transfer from expense to internal, erasing it from the ledger.
  it('does not match a longer account that merely ends with ours', () => {
    expect(matchesOwn('DO94BCBH0000000032002', own)).toBe(false);
  });

  it('does not match a near-miss differing only in the last digit', () => {
    expect(matchesOwn('XXXXXX2004', own)).toBe(false);
    expect(matchesOwn('XXXXXX2007', own)).toBe(false);
  });

  it('matches a name fragment case-insensitively', () => {
    expect(matchesOwn('JUAN ANTONIO RIVERA MARTE', own)).toBe(true);
  });

  it('returns false for null or empty input', () => {
    expect(matchesOwn(null, own)).toBe(false);
    expect(matchesOwn('', own)).toBe(false);
  });

  it('returns false when no identifiers are configured', () => {
    expect(matchesOwn('XXXXXX2003', [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test own-party`
Expected: FAIL — `Cannot find module './own-party'`

- [ ] **Step 3: Create the module**

Create `api/src/ingestion/parsers/own-party.ts`:

```typescript
/**
 * True when `value` refers to one of the caller's own identifiers.
 *
 * Numeric identifiers (account last-4) must match on a digit boundary, so
 * '2002' does not match an unrelated account ending '32002'. Getting this
 * wrong silently flips a transfer's classification and erases real money
 * from the ledger.
 */
export function matchesOwn(value: string | null | undefined, ownIdentifiers: string[]): boolean {
  if (!value) return false;
  const hay = value.toLowerCase();
  return ownIdentifiers.some((raw) => {
    const id = raw.trim().toLowerCase();
    if (!id) return false;
    if (/^\d+$/.test(id)) {
      return new RegExp(`(?<!\\d)${id}(?!\\d)`).test(hay);
    }
    return hay.includes(id);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test own-party`
Expected: PASS, 6 tests

- [ ] **Step 5: Remove the duplicate from `banreservas.parser.ts`**

Delete the local `matchesOwn` function (lines 12–26) and add to the imports at the top:

```typescript
import { matchesOwn } from './own-party';
```

- [ ] **Step 6: Run the whole suite**

Run: `cd api && pnpm test`
Expected: PASS, 69 tests (63 existing + 6 new)

- [ ] **Step 7: Commit**

```bash
git add api/src/ingestion/parsers/own-party.ts api/src/ingestion/parsers/own-party.spec.ts api/src/ingestion/parsers/banreservas.parser.ts
git commit -m "refactor(ingestion): extract matchesOwn into a shared module"
```

---

### Task 2: Add the BHD transfer date format

**Files:**
- Modify: `api/src/ingestion/parsers/dates.ts`
- Create: test block in `api/src/ingestion/parsers/dates.spec.ts` (create the file if absent)

- [ ] **Step 1: Write the failing test**

Add to `api/src/ingestion/parsers/dates.spec.ts` (create it if it does not exist, with this import line at the top: `import { parseDdMmYyyyDash12h } from './dates';`):

```typescript
describe('parseDdMmYyyyDash12h', () => {
  it('parses "28/08/2026 - 8:33 AM"', () => {
    const d = parseDdMmYyyyDash12h('28/08/2026 - 8:33 AM');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);   // August is 7
    expect(d!.getDate()).toBe(28);
    expect(d!.getHours()).toBe(8);
    expect(d!.getMinutes()).toBe(33);
  });

  it('converts PM correctly', () => {
    const d = parseDdMmYyyyDash12h('24/08/2026 - 2:51 PM');
    expect(d!.getHours()).toBe(14);
  });

  it('treats 12:xx AM as midnight', () => {
    const d = parseDdMmYyyyDash12h('02/09/2026 - 12:15 AM');
    expect(d!.getHours()).toBe(0);
  });

  it('falls back to the date-only parse when no time is present', () => {
    const d = parseDdMmYyyyDash12h('28/08/2026');
    expect(d!.getDate()).toBe(28);
  });

  it('returns null for unparseable input', () => {
    expect(parseDdMmYyyyDash12h('not a date')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test dates`
Expected: FAIL — `parseDdMmYyyyDash12h is not a function`

- [ ] **Step 3: Implement**

Append to `api/src/ingestion/parsers/dates.ts`:

```typescript
/**
 * BHD transfers: "28/08/2026 - 8:33 AM".
 *
 * A dash separates date from time, so parseDdMmYyyy12h's `\s+` does not match.
 */
export function parseDdMmYyyyDash12h(s: string): Date | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return parseDdMmYyyy(s);
  let hour = +m[4] % 12;
  if (m[6].toUpperCase() === 'PM') hour += 12;
  return new Date(+m[3], +m[2] - 1, +m[1], hour, +m[5]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test dates`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add api/src/ingestion/parsers/dates.ts api/src/ingestion/parsers/dates.spec.ts
git commit -m "feat(ingestion): add BHD transfer date format parser"
```

---

### Task 3: Extend the parser contract

**Files:**
- Modify: `api/src/ingestion/parsers/types.ts`

No test of its own — this is a type-only change exercised by Tasks 4–7. It must compile.

> **Why it is shaped this way.** An earlier revision of this plan made `parse`
> return `ParsedTransaction | typeof SKIP | null`. That broke the build in 42
> places: all four parser specs do `const r = parser.parse(...)!` and then read
> `r.amount`, and `!` strips only `null`, not a sentinel. Because every parser is
> declared `export const x: BankParser`, TypeScript types `.parse` by the
> interface, so widening the interface widened every call site. The separate
> predicate below avoids that entirely.

- [ ] **Step 1: Add the transfer kind and the non-transactional predicate**

Edit `api/src/ingestion/parsers/types.ts`. Add to `ParsedTransaction`, after `externalRef`:

```typescript
  /**
   * How this transfer moves money relative to the user's own accounts.
   * Absent means an ordinary card transaction.
   *   external   — money left to a third party; counts as an expense
   *   internal   — between the user's own cash accounts; no expense, no balance
   *   unresolved — destination could not be parsed; recorded, never asserted
   */
  transferKind?: 'external' | 'internal' | 'unresolved';
```

Add to `ParseInput`, after `ownIdentifiers`:

```typescript
  /**
   * Last-4 digits of the user's own savings/checking accounts. A transfer whose
   * DESTINATION matches one of these is internal. Deliberately separate from
   * ownIdentifiers, which also contains name fragments: the user's loan account
   * carries their own name, so a name match must never imply internal.
   */
  ownCashAccounts?: string[];
```

Add to the `BankParser` interface, after `parse`:

```typescript
  /**
   * True when this email is recognised and deliberately carries no transaction
   * — marketing, or a receipt that states no amount.
   *
   * Deliberately NOT folded into parse()'s return type. "Is this a transaction
   * email?" and "parse this transaction" are different questions, and a union
   * return would force every caller and every test to narrow the result before
   * touching a field. The casts that would require could later hide a parser
   * wrongly reporting a real transaction as non-transactional.
   *
   * The orchestrator calls this BEFORE parse(). If it is ever forgotten, the
   * mail is merely logged as an unusable parse failure — noisy, but safe.
   */
  readonly isNonTransactional?: (input: ParseInput) => boolean;
```

**Do not change `parse`'s return type.** It stays `ParsedTransaction | null`.

- [ ] **Step 2: Verify it compiles**

Run: `cd api && pnpm run build`
Expected: clean. `parse` keeps its existing return type, and `isNonTransactional` is optional, so no existing parser or spec changes.

- [ ] **Step 3: Run the suite to confirm nothing broke**

Run: `cd api && pnpm test`
Expected: PASS, 74 tests

- [ ] **Step 4: Commit**

```bash
git add api/src/ingestion/parsers/types.ts
git commit -m "feat(ingestion): add transferKind, ownCashAccounts and isNonTransactional to the parser contract"
```

---

### Task 4: BHD transfer parser

**Files:**
- Create: `api/src/ingestion/parsers/bhd-transfer.parser.ts`
- Create: `api/src/ingestion/parsers/bhd-transfer.parser.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/ingestion/parsers/bhd-transfer.parser.spec.ts`:

```typescript
import { parseBhdTransfer } from './bhd-transfer.parser';

const OWN_CASH = ['2001', '2002', '2003'];

// Third party — a real expense (housing).
const TO_THIRD_PARTY = `| |
| Estimado(a): JUAN ANTONIO RIVERA |
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXXXXX4400 |
| Descripción: | |
| Monto: | RD$ 20,000.00 |
| Beneficiario: | MARIA ALTAGRACIA GOMEZ REYES |
| Número de confirmación: | M10-1111-2222-3333-4 |
| Fecha y hora de la transacción: | 28/08/2026 - 8:33 AM |
| Tipo de transacción: | Transacciones entre productos BHD y a otros Bancos |`;

// Subject claims "otros Bancos" but the destination is the user's own account.
const TO_OWN_OTHER_BANK = `| |
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXXXXXXXXX2003 |
| Monto: | RD$ 1,000.00 |
| Beneficiario: | JUAN ANTONIO RIVERA MARTE |
| Fecha y hora de la transacción: | 02/09/2026 - 11:07 AM |
| Tipo de transacción: | Transacciones entre productos BHD y a otros Bancos |`;

// The user's own name, but the destination is a loan, not a cash account.
const TO_OWN_LOAN = `| |
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXX3050 |
| Monto: | RD$ 1,942.10 |
| Beneficiario: | JUAN RIVERA |
| Fecha y hora de la transacción: | 24/08/2026 - 2:51 PM |
| Tipo de transacción: | Transacciones entre mis productos |`;

describe('parseBhdTransfer', () => {
  it('classifies a third-party transfer as external', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_THIRD_PARTY, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('external');
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(20000);
    expect(r.currency).toBe('DOP');
    expect(r.counterparty).toBe('MARIA ALTAGRACIA GOMEZ REYES');
    expect(r.externalRef).toBe('M10-1111-2222-3333-4');
    expect(r.occurredAt.getDate()).toBe(28);
    expect(r.occurredAt.getHours()).toBe(8);
    expect(r.isWithdrawal).toBe(false);
    expect(r.approved).toBe(true);
  });

  // The phantom-expense case. The subject says the money went to another bank;
  // it went to the user's own Santa Cruz account. Classifying on subject would
  // book RD$1,000 of spending that never happened.
  it('classifies a transfer to an own cash account as internal despite the subject', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_OWN_OTHER_BANK, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('internal');
    expect(r.amount).toBe(1000);
  });

  // Regression guard: the loan is in the user's own name. A rule keyed on the
  // beneficiary would mark this internal and erase a real monthly expense.
  it('classifies a transfer to an own non-cash product as external', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_OWN_LOAN, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(1942.1);
    expect(r.counterparty).toBe('JUAN RIVERA');
  });

  // The origin is always the user's own account. A body-wide search would
  // report every BHD transfer as internal.
  it('ignores the origin account when classifying', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_THIRD_PARTY, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('external');
  });

  it('returns unresolved when the destination cannot be parsed', () => {
    const noDest = TO_THIRD_PARTY.replace('| Producto destino: | XXXXXX4400 |', '');
    const r = parseBhdTransfer({ subject: '', body: noDest, ownCashAccounts: OWN_CASH })!;
    expect(r.transferKind).toBe('unresolved');
  });

  it('returns null when the body is not a transfer email', () => {
    expect(parseBhdTransfer({ subject: '', body: 'unrelated', ownCashAccounts: OWN_CASH })).toBeNull();
  });

  it('treats an empty ownCashAccounts as nothing being internal', () => {
    const r = parseBhdTransfer({ subject: '', body: TO_OWN_OTHER_BANK, ownCashAccounts: [] })!;
    expect(r.transferKind).toBe('external');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test bhd-transfer`
Expected: FAIL — `Cannot find module './bhd-transfer.parser'`

- [ ] **Step 3: Implement**

Create `api/src/ingestion/parsers/bhd-transfer.parser.ts`:

```typescript
import { ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyyDash12h } from './dates';
import { matchesOwn } from './own-party';

/**
 * BHD transfer emails are pipe-delimited label/value rows:
 *   | Producto destino: | XXXXXX4400 |
 * Label and value are separate cells on the SAME line.
 */
function fieldValue(body: string, label: string): string | null {
  for (const line of body.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && cells[0].toLowerCase().startsWith(label.toLowerCase())) {
      return cells[1] || null;
    }
  }
  return null;
}

/** Returns null when this is not a BHD transfer email at all. */
export function parseBhdTransfer(input: ParseInput): ParsedTransaction | null {
  const { body, ownCashAccounts = [] } = input;

  const tipo = fieldValue(body, 'Tipo de transacción');
  const montoRaw = fieldValue(body, 'Monto');
  if (!tipo || !montoRaw) return null;

  const amount = toAmount(montoRaw.replace(/RD\$|US\$/g, '').trim());
  const occurredAt = parseDdMmYyyyDash12h(fieldValue(body, 'Fecha y hora de la transacción') ?? '');
  if (isNaN(amount) || !occurredAt) return null;

  const destino = fieldValue(body, 'Producto destino');
  const beneficiario = fieldValue(body, 'Beneficiario');

  // Classification is decided ONLY by the destination account. The subject and
  // Tipo de transacción both lie: a real "y a otros Bancos" email moved money
  // between two of the user's own accounts. The beneficiary name lies too — the
  // user's loan account carries their own name.
  let transferKind: 'external' | 'internal' | 'unresolved';
  if (!destino) {
    transferKind = 'unresolved';
  } else if (matchesOwn(destino, ownCashAccounts)) {
    transferKind = 'internal';
  } else {
    transferKind = 'external';
  }

  return {
    bank: 'bhd',
    direction: 'expense',
    amount,
    currency: /US\$/.test(montoRaw) ? 'USD' : 'DOP',
    occurredAt,
    counterparty: beneficiario || 'Transferencia',
    isWithdrawal: false,
    // These emails are receipts of completed transfers; there is no Estado field.
    approved: true,
    externalRef: fieldValue(body, 'Número de confirmación') ?? undefined,
    transferKind,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test bhd-transfer`
Expected: PASS, 7 tests

- [ ] **Step 5: Wire the dispatcher**

Edit `api/src/ingestion/parsers/bhd.parser.ts`. Add to the imports:

```typescript
import { parseBhdTransfer } from './bhd-transfer.parser';
```

Then make `parse` try the transfer format first, before the card-table heuristic:

```typescript
  parse(input: ParseInput): ParsedTransaction | null {
    // Discriminate on format BEFORE falling back to the card-table heuristic.
    // That heuristic scans for "any pipe row containing a date", which a
    // transfer email also satisfies — it is rejected today only because the
    // matched row happens to have too few cells. That is an accident, not a
    // decision.
    const transfer = parseBhdTransfer(input);
    if (transfer) return transfer;

    const { body } = input;
    // ...existing card-table body unchanged...
```

No import change is needed — `parse` keeps its existing return type.

- [ ] **Step 6: Run the whole suite**

Run: `cd api && pnpm test`
Expected: PASS, 81 tests. The existing BHD card tests must still pass — the transfer parser returns `null` for them, so the dispatcher falls through.

- [ ] **Step 7: Commit**

```bash
git add api/src/ingestion/parsers/bhd-transfer.parser.ts api/src/ingestion/parsers/bhd-transfer.parser.spec.ts api/src/ingestion/parsers/bhd.parser.ts
git commit -m "feat(ingestion): add BHD transfer parser with destination-based classification"
```

---

### Task 5: Popular transfer parser — sent and received

**Files:**
- Create: `api/src/ingestion/parsers/popular-transfer.parser.ts`
- Create: `api/src/ingestion/parsers/popular-transfer.parser.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/ingestion/parsers/popular-transfer.parser.spec.ts`:

```typescript
import { parsePopularTransfer } from './popular-transfer.parser';

const OWN_CASH = ['2001', '2002', '2003'];

// Funding move: the user sending money to their own account at another bank.
const SENT_TO_OWN = `| Estimado (a) SR JUAN ANTONIO RIVERA MARTE |
| Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente. |
| Beneficiario: JUAN ANTONIO RIVERA MART |
| Cuenta o Producto:******_2002 |
| Monto: RD$ 20,000.00 |
| Fecha: 28/8/2026 |`;

const SENT_TO_THIRD_PARTY = `| Estimado (a) SR JUAN ANTONIO RIVERA MARTE |
| Le informamos que su transacción por pagos al instante fue enviada satisfactoriamente. |
| Beneficiario: PEDRO NUNEZ |
| Cuenta o Producto:******_9911 |
| Monto: RD$ 3,500.00 |
| Fecha: 5/7/2026 |`;

const RECEIVED = `| Estimado(a) ANTONIO RIVERA JUAN Le informamos los detalles de la transacción de transferencia recibida en su cuenta terminada en 2001 : |
| Monto | Fecha | Canal |
|---|---|---|
| RD 2,000.00 | 7/8/2026 | APP POPULAR |`;

describe('parsePopularTransfer — sent', () => {
  it('classifies a transfer to an own cash account as internal', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: SENT_TO_OWN,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.transferKind).toBe('internal');
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(20000);
    expect(r.occurredAt.getDate()).toBe(28);
    expect(r.occurredAt.getMonth()).toBe(7);
  });

  it('classifies a transfer to a third party as external', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: SENT_TO_THIRD_PARTY,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.transferKind).toBe('external');
    expect(r.amount).toBe(3500);
    expect(r.counterparty).toBe('PEDRO NUNEZ');
  });

  it('parses the unpadded D/M/YYYY date', () => {
    const r = parsePopularTransfer({
      subject: 'Notificaciones Pagos al Instante transferencia enviada',
      body: SENT_TO_THIRD_PARTY,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.occurredAt.getDate()).toBe(5);
    expect(r.occurredAt.getMonth()).toBe(6);  // July
  });
});

describe('parsePopularTransfer — received', () => {
  it('parses an incoming transfer as income', () => {
    const r = parsePopularTransfer({
      subject: 'Notificación transf recibida via app e IB',
      body: RECEIVED,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.direction).toBe('income');
    expect(r.amount).toBe(2000);
    expect(r.transferKind).toBe('external');
  });

  // "RD 2,000.00" has no dollar sign, which is why the v1 amount regex misses it.
  it('parses an amount written without a dollar sign', () => {
    const r = parsePopularTransfer({
      subject: 'Notificación transf recibida via app e IB',
      body: RECEIVED,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.amount).toBe(2000);
  });

  it('parses the D/M/YYYY date, not M/D/YYYY', () => {
    const r = parsePopularTransfer({
      subject: 'Notificación transf recibida via app e IB',
      body: RECEIVED,
      ownCashAccounts: OWN_CASH,
    })!;
    expect(r.occurredAt.getDate()).toBe(7);
    expect(r.occurredAt.getMonth()).toBe(7);  // August
  });
});

describe('parsePopularTransfer — not applicable', () => {
  it('returns null for a subject it does not own', () => {
    expect(parsePopularTransfer({
      subject: 'Notificación de Consumo',
      body: 'anything',
      ownCashAccounts: OWN_CASH,
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test popular-transfer`
Expected: FAIL — `Cannot find module './popular-transfer.parser'`

- [ ] **Step 3: Implement**

Create `api/src/ingestion/parsers/popular-transfer.parser.ts`:

```typescript
import { ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyy } from './dates';
import { matchesOwn } from './own-party';

/** Popular puts label and value on the SAME line: "Monto: RD$ 20,000.00". */
function inlineValue(body: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:?\\s*([^|\\n]+)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function parseSent(input: ParseInput): ParsedTransaction | null {
  const { body, ownCashAccounts = [] } = input;

  const montoRaw = inlineValue(body, 'Monto');
  const fechaRaw = inlineValue(body, 'Fecha');
  if (!montoRaw || !fechaRaw) return null;

  const amount = toAmount(montoRaw.replace(/RD\$|US\$|RD\s/g, '').trim());
  const occurredAt = parseDdMmYyyy(fechaRaw);
  if (isNaN(amount) || !occurredAt) return null;

  const beneficiario = inlineValue(body, 'Beneficiario');
  const cuenta = inlineValue(body, 'Cuenta o Producto');

  // Destination account decides, never the beneficiary name.
  const transferKind = !cuenta
    ? 'unresolved'
    : matchesOwn(cuenta, ownCashAccounts)
      ? 'internal'
      : 'external';

  return {
    bank: 'popular',
    direction: 'expense',
    amount,
    currency: /US\$/.test(montoRaw) ? 'USD' : 'DOP',
    occurredAt,
    counterparty: beneficiario || 'Transferencia enviada',
    isWithdrawal: false,
    // "fue enviada satisfactoriamente" is the success signal; there is no Aprobada.
    approved: true,
    transferKind,
  };
}

function parseReceived(input: ParseInput): ParsedTransaction | null {
  // Markdown-style table; the data row is the one carrying a date.
  const row = input.body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('|') && /\d{1,2}\/\d{1,2}\/\d{4}/.test(l) && !/^\|[-|\s]+\|$/.test(l));
  if (!row) return null;

  const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;

  // "RD 2,000.00" — no dollar sign, unlike every other Popular format.
  const amount = toAmount(cells[0].replace(/RD\$|US\$|RD/g, '').trim());
  const occurredAt = parseDdMmYyyy(cells[1]);
  if (isNaN(amount) || !occurredAt) return null;

  return {
    bank: 'popular',
    direction: 'income',
    amount,
    currency: /US/.test(cells[0]) && /US\$/.test(cells[0]) ? 'USD' : 'DOP',
    occurredAt,
    // The email names only a channel, never a sender.
    counterparty: 'Transferencia recibida',
    isWithdrawal: false,
    approved: true,
    transferKind: 'external',
  };
}

export function parsePopularTransfer(input: ParseInput): ParsedTransaction | null {
  const subject = input.subject.toLowerCase();
  if (subject.includes('pagos al instante')) return parseSent(input);
  if (subject.includes('transf recibida')) return parseReceived(input);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test popular-transfer`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add api/src/ingestion/parsers/popular-transfer.parser.ts api/src/ingestion/parsers/popular-transfer.parser.spec.ts
git commit -m "feat(ingestion): add Popular sent and received transfer parsers"
```

---

### Task 6: Popular dispatcher and known-skip list

**Files:**
- Modify: `api/src/ingestion/parsers/popular.parser.ts`
- Modify: `api/src/ingestion/parsers/popular.parser.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `api/src/ingestion/parsers/popular.parser.spec.ts`:

```typescript
describe('popularParser — known non-transactional mail', () => {
  // This arrives from an allow-listed sender and is tab-delimited with RD$
  // amounts, exactly the shape the consumption parser hunts for. Ingesting it
  // would invent a RD$25,000 expense out of a marketing message.
  const LIMIT_INCREASE = `Estimado (a) JUAN ANTONIO RIVERA MARTE

¡Hemos aplicado un aumento de límite a tu tarjeta!

TARJETA\t LÍMITE ANTERIOR\tNUEVO LÍMITE\t
VISA ISI\tRD$25,000\tRD$50,000\t`;

  const NOMINA = `Estimado(a): ANTONIO RIVERA JUAN No. de identificación XXX-XXXX-0000
Le informamos que ha sido acreditado el pago de su nómina en su cuenta terminada en 2001.`;

  it('flags a limit-increase notice as non-transactional', () => {
    expect(popularParser.isNonTransactional!({ subject: 'Actualización de Límite', body: LIMIT_INCREASE })).toBe(true);
  });

  it('flags a payroll notice as non-transactional, since it carries no amount', () => {
    expect(popularParser.isNonTransactional!({ subject: 'Notificación Depósito de Nómina', body: NOMINA })).toBe(true);
  });

  // Belt and braces: even if the orchestrator forgot the predicate, parse()
  // must not invent a RD$25,000 expense out of a marketing table.
  it('never parses a transaction out of a limit-increase notice', () => {
    expect(popularParser.parse({ subject: 'Actualización de Límite', body: LIMIT_INCREASE })).toBeNull();
  });

  it('never parses a transaction out of a payroll notice', () => {
    expect(popularParser.parse({ subject: 'Notificación Depósito de Nómina', body: NOMINA })).toBeNull();
  });

  it('does not flag a real consumption email as non-transactional', () => {
    expect(popularParser.isNonTransactional!({ subject: 'Notificación de Consumo', body: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test popular.parser`
Expected: FAIL — `popularParser.isNonTransactional` is not a function

- [ ] **Step 3: Implement the dispatcher**

Edit `api/src/ingestion/parsers/popular.parser.ts`. Replace the imports and the opening of `parse`:

```typescript
import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
import { parseDdMmYyyy } from './dates';
import { parsePopularTransfer } from './popular-transfer.parser';

/**
 * Subjects that arrive from the transaction sender but carry no transaction.
 * They must be recognised explicitly: counting them as parse failures would
 * bury the real failures under monthly noise.
 */
const KNOWN_NON_TRANSACTIONAL = [
  'actualización de límite',
  'actualizacion de limite',
  'depósito de nómina',
  'deposito de nomina',
];

export const popularParser: BankParser = {
  bank: 'popular',
  senders: ['notificaciones@popularenlinea.com'],

  isNonTransactional({ subject }: ParseInput): boolean {
    const s = subject.toLowerCase();
    return KNOWN_NON_TRANSACTIONAL.some((k) => s.includes(k));
  },

  parse(input: ParseInput): ParsedTransaction | null {
    // Defence in depth: even reached directly, these must never yield a
    // transaction. The limit-increase mail is tab-delimited with RD$ amounts,
    // which is exactly the shape the consumption branch below hunts for.
    if (this.isNonTransactional!(input)) return null;

    const transfer = parsePopularTransfer(input);
    if (transfer) return transfer;

    const { subject: rawSubject, body } = input;
    // ...existing consumption/withdrawal body unchanged...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test popular`
Expected: PASS. Existing consumption and withdrawal tests still pass.

- [ ] **Step 5: Run the whole suite**

Run: `cd api && pnpm test`
Expected: PASS, 92 tests

- [ ] **Step 6: Commit**

```bash
git add api/src/ingestion/parsers/popular.parser.ts api/src/ingestion/parsers/popular.parser.spec.ts
git commit -m "feat(ingestion): dispatch Popular formats and skip known non-transactional mail"
```

---

### Task 7: Schema fields in both services

**Files:**
- Modify: `api/src/shared/schemas/transaction.schema.ts`
- Modify: `repo/src/mongodb/schemas/transaction.schemas.ts`

- [ ] **Step 1: Add the fields to `api/`**

Append inside the `Transaction` class in `api/src/shared/schemas/transaction.schema.ts`, after `externalRef`:

```typescript
  /** 'external' | 'internal' | 'unresolved'. Absent for ordinary card transactions. */
  @Prop() transferKind?: string;

  /** The recurring rule this transaction satisfies, when reconciled. */
  @Prop() recurringId?: string;
```

- [ ] **Step 2: Mirror into `repo/`**

Append inside the `Transaction` class in `repo/src/mongodb/schemas/transaction.schemas.ts`, after `externalRef`:

```typescript
  @Prop()
  transferKind?: string;

  @Prop()
  recurringId?: string;
```

- [ ] **Step 3: Verify both build**

Run: `cd api && pnpm run build`
Expected: clean

Run: `cd repo && npm run build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add api/src/shared/schemas/transaction.schema.ts repo/src/mongodb/schemas/transaction.schemas.ts
git commit -m "feat(schemas): add transferKind and recurringId to both services"
```

---

### Task 8: Orchestrator honours transferKind and skips non-transactional mail

**Files:**
- Modify: `api/src/ingestion/ingestion.service.ts`
- Modify: `api/src/ingestion/ingestion.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `api/src/ingestion/ingestion.service.spec.ts`, inside the existing top-level `describe`. Follow the mocking style already used in that file for models and services:

```typescript
  it('does not move the balance for an internal transfer', async () => {
    // Arrange a parsed internal transfer through the existing mock harness.
    // Expect: the transaction is created, balance.save is NOT called.
    // (Wire this using the same mocks the neighbouring tests use.)
  });
```

Replace that placeholder body with a concrete test modelled on the existing `applies balance for an expense` test in the same file — same mocks, same arrange/act/assert shape — asserting instead:

```typescript
    expect(txModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ transferKind: 'internal' }),
    );
    expect(balanceDoc.save).not.toHaveBeenCalled();
    expect(historyModel.create).not.toHaveBeenCalled();
```

Add two more in the same style:

```typescript
  it('does not move the balance for an unresolved transfer', async () => {
    // Same shape; transferKind: 'unresolved', balance untouched.
  });

  it('counts a non-transactional email as skipped, not failed, and does not warn', async () => {
    // Parser's isNonTransactional returns true; expect result.skipped === 1,
    // result.failed === 0, logger.warn not called, and parse() never invoked.
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test ingestion.service`
Expected: FAIL — balance is currently applied for every parsed transaction

- [ ] **Step 3: Implement**

In `api/src/ingestion/ingestion.service.ts`:

In `run()`, read the new config and check the predicate **before calling `parse`**:

```typescript
    const ownCashAccounts = (process.env.OWN_CASH_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
```

Pass it into every `parser.parse({ ... })` call alongside `ownIdentifiers`.

Then:

```typescript
      // Recognised and deliberately ignored — not a failure, so it must not
      // reach the "unusable mail" warning below. Payroll notices arrive monthly
      // and marketing more often; logging them as failures would bury the real
      // failures under routine noise.
      if (parser.isNonTransactional?.({ subject: mail.subject, body: mail.body })) {
        skipped++;
        continue;
      }
```

Place this immediately after the parser is resolved and **before** the `parser.parse(...)` call.

In `persist()`, carry the field onto the document:

```typescript
        transferKind: p.transferKind,
```

And gate the balance call — this is the whole point of the change:

```typescript
      // Only external transfers and ordinary card transactions move money.
      // Internal transfers net to zero against the single Balance document,
      // and an unresolved one has not been asserted yet.
      if (p.transferKind === 'internal' || p.transferKind === 'unresolved') {
        return 'created';
      }
      await this.applyBalance(p, amount, String(doc._id));
      return 'created';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test ingestion.service`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.service.spec.ts
git commit -m "feat(ingestion): keep internal and unresolved transfers out of the balance"
```

---

### Task 9: Exclude internal and unresolved from expense aggregation

**Files:**
- Modify: `api/src/transactions/transactions.service.ts:50-66`
- Modify: `api/src/transactions/transactions.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `api/src/transactions/transactions.service.spec.ts`:

```typescript
  it('excludes internal and unresolved transfers from expense queries', async () => {
    await service.findAll({ type: 'expense' });
    expect(transactionModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        transferKind: { $nin: ['internal', 'unresolved'] },
      }),
    );
  });

  it('excludes them from CSV export too', async () => {
    await service.exportCsv({ type: 'expense' });
    expect(transactionModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        transferKind: { $nin: ['internal', 'unresolved'] },
      }),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test transactions.service`
Expected: FAIL — the filter has no `transferKind` clause

- [ ] **Step 3: Implement**

In `buildFilter()` in `api/src/transactions/transactions.service.ts`, after the existing `filter.userId` line:

```typescript
    // Internal transfers move money between the user's own accounts and
    // unresolved ones have not been asserted, so neither is spending.
    // $nin also matches documents where the field is absent, which is what
    // every ordinary card transaction looks like.
    filter.transferKind = { $nin: ['internal', 'unresolved'] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test transactions.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/transactions/transactions.service.ts api/src/transactions/transactions.service.spec.ts
git commit -m "feat(api): exclude internal and unresolved transfers from expense totals"
```

---

## Phase 2 — Recurring reconciliation

> Phase 1 must not reach production without this phase. Parsing the transfer emails is exactly what creates the double-count that reconciliation prevents.

### Task 10: ReconciliationService matching rule

**Files:**
- Create: `api/src/ingestion/reconciliation.service.ts`
- Create: `api/src/ingestion/reconciliation.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/ingestion/reconciliation.service.spec.ts`:

```typescript
import { matchesRule } from './reconciliation.service';

const rule = { _id: 'r1', userId: 1, amount: 1942.1, dayOfMonth: 24, active: true };

describe('matchesRule', () => {
  it('matches an exact amount within the date window', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(true);
  });

  it('matches at the edges of the +/-3 day window', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 21) })).toBe(true);
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 27) })).toBe(true);
  });

  it('rejects a date outside the window', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 28) })).toBe(false);
  });

  // No tolerance: these are fixed payments, so a near-miss is a different
  // transaction, not the same one rounded.
  it('rejects an amount that differs at all', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.11, timestamp: new Date(2026, 7, 24) })).toBe(false);
  });

  it('compares on absolute value, since expenses are stored negative', () => {
    expect(matchesRule(rule, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(true);
  });

  it('rejects an inactive rule', () => {
    expect(matchesRule({ ...rule, active: false }, { userId: 1, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(false);
  });

  it('rejects a different user', () => {
    expect(matchesRule(rule, { userId: 2, amount: -1942.1, timestamp: new Date(2026, 7, 24) })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test reconciliation`
Expected: FAIL — `Cannot find module './reconciliation.service'`

- [ ] **Step 3: Implement**

Create `api/src/ingestion/reconciliation.service.ts`:

```typescript
/** Days either side of a rule's dayOfMonth that still count as the same payment. */
export const MATCH_WINDOW_DAYS = 3;

export interface RuleLike {
  _id: unknown;
  userId: number;
  amount: number;
  dayOfMonth: number;
  active: boolean;
}

export interface TxLike {
  userId: number;
  amount: number;
  timestamp: Date;
}

/**
 * True when `tx` is the real-world payment that `rule` predicts.
 *
 * Amounts must be EXACTLY equal in absolute value. These are fixed monthly
 * payments, so a tolerance would buy nothing and would let a genuinely
 * different payment of a similar size be swallowed as a duplicate.
 */
export function matchesRule(rule: RuleLike, tx: TxLike): boolean {
  if (!rule.active) return false;
  if (rule.userId !== tx.userId) return false;
  if (Math.abs(rule.amount) !== Math.abs(tx.amount)) return false;

  const day = tx.timestamp.getDate();
  return Math.abs(day - rule.dayOfMonth) <= MATCH_WINDOW_DAYS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test reconciliation`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add api/src/ingestion/reconciliation.service.ts api/src/ingestion/reconciliation.service.spec.ts
git commit -m "feat(ingestion): add recurring reconciliation matching rule"
```

---

### Task 11: Recurring cron skips fulfilled months and stops double-firing

**Files:**
- Modify: `repo/src/service/recurring.service.ts:56-80`
- Create: `repo/src/service/recurring.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `repo/src/service/recurring.service.spec.ts`, mocking `recurringModel`, `transactionService` and `balanceService`:

```typescript
describe('RecurringService.processRecurring', () => {
  it('creates one transaction for a due rule', async () => {
    // rule due today, lastExecutedAt undefined -> createTransaction called once
  });

  // lastExecutedAt is written today but never read, so a pod restart or a
  // redeploy on the same day produces a second transaction for one payment.
  it('does not fire twice in the same month', async () => {
    // rule.lastExecutedAt = earlier today -> createTransaction NOT called
  });

  it('fires again the following month', async () => {
    // rule.lastExecutedAt = last month -> createTransaction called
  });

  it('skips a rule already satisfied by an ingested transaction this month', async () => {
    // a transaction exists with recurringId === rule._id this month
    // -> createTransaction NOT called
  });
});
```

Write each body concretely against the mocks — do not leave the comments as the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd repo && npm test -- recurring.service`
Expected: FAIL — the service fires unconditionally

- [ ] **Step 3: Implement**

In `repo/src/service/recurring.service.ts`, inside the `for (const r of due)` loop, before creating anything:

```typescript
        // lastExecutedAt was previously written but never read, so two runs on
        // the same day created two transactions for one payment.
        if (r.lastExecutedAt && isSameMonth(r.lastExecutedAt, new Date())) {
          this.logger.log(`Recurring "${r.transactionName}" already executed this month — skipping`);
          continue;
        }

        // The bank email may already have recorded this payment. The email is
        // evidence the money moved; the rule is only a prediction.
        const alreadyIngested = await this.transactionService.findOneByRecurringThisMonth(
          r.userId,
          String(r._id),
        );
        if (alreadyIngested) {
          this.logger.log(`Recurring "${r.transactionName}" already satisfied by ingested mail — skipping`);
          r.lastExecutedAt = new Date();
          await r.save();
          continue;
        }
```

Add the helper at the bottom of the file:

```typescript
function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
```

Add `findOneByRecurringThisMonth` to `repo/src/service/transaction.service.ts`:

```typescript
  async findOneByRecurringThisMonth(userId: number, recurringId: string) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return this.transactionModel
      .findOne({ userId, recurringId, timestamp: { $gte: start, $lt: end } })
      .exec();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd repo && npm test -- recurring.service`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add repo/src/service/recurring.service.ts repo/src/service/recurring.service.spec.ts repo/src/service/transaction.service.ts
git commit -m "fix(recurring): skip months already fulfilled and stop same-day double-firing"
```

---

### Task 12: Ingestion links and upgrades recurring transactions

**Files:**
- Modify: `api/src/ingestion/ingestion.service.ts`
- Modify: `api/src/ingestion/ingestion.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `api/src/ingestion/ingestion.service.spec.ts`, concretely against the existing mocks:

```typescript
  it('links an ingested transaction to the recurring rule it satisfies', async () => {
    // an active rule matches amount + date
    // expect txModel.create called with recurringId === rule._id
  });

  it('upgrades an existing predicted transaction instead of creating a second one', async () => {
    // a transaction already exists with recurringId set and no sourceMessageId
    // expect findOneAndUpdate called with sourceMessageId, merchant, externalRef
    // expect txModel.create NOT called
    // expect balance NOT moved again — the prediction already moved it
  });

  it('does not swallow a genuine second payment of the same amount in one month', async () => {
    // the rule is already matched this month by another transaction
    // expect a NEW transaction created, with recurringId undefined
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test ingestion.service`
Expected: FAIL — no reconciliation exists in the service

- [ ] **Step 3: Implement**

Inject the `Recurring` model into `IngestionService` (register it in `api/src/ingestion/ingestion.module.ts` using the existing `MongooseModule.forFeature` pattern), import `matchesRule`, and in `persist()` before creating:

```typescript
    const rules = await this.recurringModel.find({ userId: this.userId, active: true }).lean();
    const candidate = { userId: this.userId, amount: signed, timestamp: p.occurredAt };
    const rule = rules.find((r) => matchesRule(r as any, candidate));

    if (rule) {
      const monthStart = new Date(p.occurredAt.getFullYear(), p.occurredAt.getMonth(), 1);
      const monthEnd = new Date(p.occurredAt.getFullYear(), p.occurredAt.getMonth() + 1, 1);
      const predicted = await this.txModel.findOne({
        userId: this.userId,
        recurringId: String(rule._id),
        timestamp: { $gte: monthStart, $lt: monthEnd },
      });

      if (predicted && !predicted.sourceMessageId) {
        // The cron fired first. Confirm the prediction in place: no second row,
        // and no second balance movement — the prediction already moved it.
        predicted.sourceMessageId = messageId;
        predicted.merchant = p.counterparty;
        predicted.externalRef = p.externalRef;
        predicted.timestamp = p.occurredAt;
        await predicted.save();
        this.logger.log(`Confirmed recurring "${rule.transactionName}" from mail ${messageId}`);
        return 'created';
      }

      if (predicted) {
        // Already reconciled this month. This is a genuine second payment of the
        // same amount — record it normally rather than swallowing it.
        this.logger.log(`Rule ${String(rule._id)} already matched this month; recording ${messageId} separately`);
      }
    }
```

Then include `recurringId` on the created document when a rule matched and nothing was already reconciled:

```typescript
        recurringId: rule && !predictedAlreadyMatched ? String(rule._id) : undefined,
```

Hoist `predicted` out of the `if` block so this expression can see it, and log every match decision with both ids so a wrong match is diagnosable afterwards.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test ingestion.service`
Expected: PASS

- [ ] **Step 5: Run everything**

Run: `cd api && pnpm test` — Expected: PASS
Run: `cd api && pnpm run build` — Expected: clean
Run: `cd repo && npm test` — Expected: PASS
Run: `cd repo && npm run build` — Expected: clean
Run: `cd web && pnpm run build` — Expected: clean

- [ ] **Step 6: Commit**

```bash
git add api/src/ingestion/ingestion.service.ts api/src/ingestion/ingestion.service.spec.ts api/src/ingestion/ingestion.module.ts
git commit -m "feat(ingestion): reconcile ingested mail against recurring rules in both directions"
```

---

### Task 13: Document the new configuration

**Files:**
- Modify: `api/.env.example`
- Modify: `README.md`
- Modify: `api/k8s/deployment.yaml`

- [ ] **Step 1: Add to `api/.env.example`**

After `OWN_ACCOUNT_IDENTIFIERS`:

```
# Comma-separated last-4 digits of your own savings/checking accounts. A
# transfer whose DESTINATION matches one of these is an internal move between
# your own accounts: recorded and visible, but never counted as an expense and
# never applied to your balance.
#
# Deliberately separate from OWN_ACCOUNT_IDENTIFIERS, which also holds name
# fragments. A loan account carries your own name, so a name match must never
# imply "internal" — that would erase a real monthly expense.
#
# If empty, no transfer is ever classified internal: transfers are treated as
# expenses, which over-reports visibly rather than losing money silently.
OWN_CASH_ACCOUNTS=
```

- [ ] **Step 2: Add the README row**

In the "Environment Variables (API)" table:

```
| `OWN_CASH_ACCOUNTS` | Comma-separated last-4s of your own savings/checking accounts; transfers to these are internal, not expenses (default: empty — no transfer is treated as internal) |
```

- [ ] **Step 3: Add to k8s**

In `api/k8s/deployment.yaml`, alongside the other plain ingestion vars:

```yaml
            - name: OWN_CASH_ACCOUNTS
              value: ""
```

- [ ] **Step 4: Verify**

Run: `cd api && pnpm run build`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add api/.env.example README.md api/k8s/deployment.yaml
git commit -m "docs: document OWN_CASH_ACCOUNTS"
```

---

## Plan self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| BHD transfer parser, pipe label/value | 4 |
| Fourth BHD date shape (`- h:mm AM/PM`) | 2 |
| Destination-only classification | 4, 5 |
| Beneficiary name never used | 4 (loan regression test) |
| Popular sent transfer + own-party detection | 5 |
| Popular received transfer (income, no `$`) | 5 |
| Nómina recognised, never scraped | 6 |
| Marketing mail explicitly skipped | 6 |
| `matchesOwn` shared, digit-boundary | 1 |
| `transferKind` on both schemas | 7 |
| `internal`/`unresolved` never move balance | 8 |
| Excluded from expense aggregation | 9 |
| Reconciliation matching rule | 10 |
| Cron skips fulfilled months | 11 |
| `lastExecutedAt` idempotency bug | 11 |
| Email-first linking / cron-first upgrade | 12 |
| Genuine second same-amount payment not swallowed | 12 |
| `OWN_CASH_ACCOUNTS` documented | 13 |

> **Post-review correction.** The "excluded from expense aggregation → Task 9" row above was false as executed. Task 9 covered one file; the spec named five; the real count was **thirteen** — eleven from a reviewer grepping every `find`/`aggregate` in both services, two more from the implementer reading each file in full — including the bot's budget-alert cron, which then disagreed with `/budget`, and the two services feeding the Mistral prompt. Closed in follow-up commits. Lesson for the next plan: when a spec says "every site that does X", the task must include the grep, not a list.

**Gaps deliberately deferred:** the web UI for resolving an `unresolved` transfer. Every format observed in the live mailbox classifies deterministically, so `unresolved` is a safety net that should never fire in practice. Building UI for a state that does not occur is speculative; when one does appear it will be visible in the logs and in the transactions list, and the UI can follow. Salary as recurring income needs no code — the user creates an ordinary recurring income rule and Task 11's skip logic plus Task 6's `isNonTransactional` handle the rest.

**Placeholder scan:** Tasks 8, 11 and 12 describe test bodies rather than spelling out every mock. That is deliberate — those specs must match the mocking harness already present in `ingestion.service.spec.ts` and the implementer should read it first. Every assertion to make is stated explicitly. No step says "add error handling" or "write tests for the above".

**Type consistency:** `matchesOwn(value, ownIdentifiers)` is used with that signature in Tasks 1, 4 and 5. `transferKind` is the same string union in Tasks 3, 4, 5, 7, 8 and 9. `matchesRule(rule, tx)` is defined in Task 10 and used in Task 12. `parseDdMmYyyyDash12h` is defined in Task 2 and used in Task 4. `isNonTransactional` is declared in Task 3, implemented in Task 6, called in Task 8; `parse` keeps returning `ParsedTransaction | null` throughout, so no existing call site changes.

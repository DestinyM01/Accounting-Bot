# Bank Email Ingestion v2 — Design Spec

**Goal:** Cover every bank email format that carries a real transaction, and make sure no economic event is ever counted twice — not by two banks reporting the same money movement, and not by a recurring rule firing for a payment the email already recorded.

**Context:** v1 (shipped) handles card consumption for Popular, BHD and Santa Cruz, plus Banreservas wire receipts. Reading the live mailbox afterwards turned up **five more formats** carrying real money, and **two distinct double-counting mechanisms** that v1 would have walked straight into.

**Relationship to v1:** additive. Nothing in v1 is wrong; it is incomplete. The `sourceMessageId` unique index, the forward-only watermark, the sender allow-list and the never-silently-drop rule all carry over unchanged.

---

## Why this is one spec and not two

Phase 1 (new parsers) and Phase 2 (recurring reconciliation) are causally coupled: **Phase 1 creates the risk Phase 2 fixes.**

Today the housing and loan transfer emails are not parsed at all, so a recurring rule covering them cannot double-count. The moment Phase 1 lands, both the rule and the email produce a transaction. Phase 1 must therefore **not reach production without Phase 2**.

They are separate task groups in the plan. They are not separate releases.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Internal vs expense | **Decided solely by destination account** | Subject lines lie; a transfer titled "a otros Bancos" was observed moving money between two of the user's own accounts. |
| Beneficiary name | **Never used for the internal test** | The loan payment carries the user's own name; a name-based rule would erase it. |
| Own transfers | **Recorded, tagged `internal`, excluded from expenses and budgets** | Keeps the money trail auditable without inflating spending. Balance impact is zero by definition. |
| Unparseable destination | **`unresolved`, no balance impact until classified** | We do not know whether money left the user's net worth, so we do not assert that it did. |
| Recurring vs email | **Bidirectional auto-match, exact amount** | Either side can arrive first. Exact-amount matching avoids false positives on fixed payments. |
| Salary (`Depósito de Nómina`) | **Recurring income rule, confirmed by the email** | The email carries no amount, so it cannot create a transaction. It can confirm one. |
| Marketing mail | **Explicitly recognised and skipped** | Known non-transactional subjects must not be counted as parse failures. |

---

## Verified email formats

Every sample below is real, pulled from `juan.rivera@gmail.com`. They are the parser contract and become test fixtures verbatim.

### Already handled in v1

| Sender | Subject | Direction |
|---|---|---|
| `notificaciones@popularenlinea.com` | `Notificación de Consumo` | expense |
| `notificaciones@popularenlinea.com` | `Notificación de Retiro` | expense, `isWithdrawal` |
| `alertas@bhd.com.do` | `BHD Notificación de Transacciones` | expense |
| `notificaciones@bsc.com.do` | `Notificación, Banco Santa Cruz` | expense |
| `notificacionestubancoapp@banreservas.com` | `Recibo de la transacción` | direction-detected |

### New — BHD transfers

Both subjects arrive from `Alertas@bhd.com.do`. **Both are pipe-delimited label/value rows**, unlike the v1 BHD card table.

**`Transacciones entre productos BHD y a otros Bancos`** — this subject does **not** mean the money left the user. See the discriminator warning below.

```
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXXXXX4400 |
| Descripción: | |
| Monto: | RD$ 20,000.00 |
| Beneficiario: | MARIA ALTAGRACIA GOMEZ REYES |
| Número de confirmación: | M10-1111-2222-3333-4 |
| Fecha y hora de la transacción: | 28/08/2026 - 8:33 AM |
| Tipo de transacción: | Transacciones entre productos BHD y a otros Bancos |
```

**`Transacciones entre mis productos`** — transfer between the user's own products:

```
| Producto destino: | XXX3050 |
| Monto: | RD$ 1,942.10 |
| Beneficiario: | JUAN RIVERA |
| Fecha y hora de la transacción: | 24/08/2026 - 2:51 PM |
| Tipo de transacción: | Transacciones entre mis productos |
```

A third real sample — **same subject as the first**, but the destination is the user's own Santa Cruz account:

```
| Producto origen: | DO94BCBH000000000XXXXXXX2002 |
| Producto destino: | XXXXXXXXXX2003 |
| Monto: | RD$ 1,000.00 |
| Beneficiario: | JUAN ANTONIO RIVERA MARTE |
| Fecha y hora de la transacción: | 02/09/2026 - 11:07 AM |
| Tipo de transacción: | Transacciones entre productos BHD y a otros Bancos |
```

> **Discriminator warning.** `Tipo de transacción` and the subject are **not** reliable indicators of whether money left the user. The sample above reads "a otros Bancos" while moving money between two of the user's own accounts. Classifying on subject would book a phantom RD$1,000 expense. **Only `Producto destino` decides.**

Notes:
- Date format `DD/MM/YYYY - h:mm AM/PM` — **a fourth BHD-family date shape**, distinct from the v1 card format.
- `Monto` uses a comma thousands separator and a space after `RD$`.
- `Descripción` is routinely empty. Never use it as the counterparty.
- There is **no `Estado` field**. These emails are receipts of completed transfers, so `approved` is true by construction — same rule as Banreservas.
- `Número de confirmación` → `externalRef`.

### New — Popular transfers and deposits

**`Notificaciones Pagos al Instante transferencia enviada`** — transfer out. Note the sender is **uppercase** `NOTIFICACIONES@popularenlinea.com`; the allow-list already lowercases both sides, so no change is needed, but the comparison must stay case-insensitive.

```
| Beneficiario: JUAN ANTONIO RIVERA MART |
| Cuenta o Producto:******_2002 |
| Monto: RD$ 20,000.00 |
| Fecha: 28/8/2026 |
```

Label and value share a line, unlike Banreservas. Date is `D/M/YYYY`, **unpadded, no time**. There is no `Aprobada` — "fue enviada satisfactoriamente" is the success signal.

**`Notificación transf recibida via app e IB`** — income:

```
| Monto | Fecha | Canal |
|---|---|---|
| RD 2,000.00 | 7/8/2026 | APP POPULAR |
```

- **`RD 2,000.00` has no `$`.** The v1 amount regex requires `RD\$`, which is why this format is currently missed.
- Date `7/8/2026` is `D/M/YYYY` — confirmed against the message's own received date of 7 August 2026.
- **No counterparty is given**, only a channel. Counterparty becomes `Transferencia recibida`.

**`Notificación Depósito de Nómina`** — salary:

```
Le informamos que ha sido acreditado el pago de su nómina en su cuenta terminada en 2001.
```

**This email contains no amount.** The only digits in the body are an identity number, an account suffix and a phone number. It cannot produce a transaction and must never be scraped for a figure.

**`Actualización de Límite`** — marketing, must never be ingested:

```
TARJETA	 LÍMITE ANTERIOR	NUEVO LÍMITE
VISA ISI	RD$25,000	RD$50,000
```

It arrives from an allow-listed sender and is tab-delimited with `RD$` amounts — the exact shape the Popular parser searches for. v1 rejects it only because it requires the literal word `Aprobada` alongside a date. That guard is load-bearing and must be preserved and made explicit.

---

## The two double-counting mechanisms

### 1. Cross-bank: one payment, two banks

Observed on 28 August 2026:

| Bank | Amount | Beneficiario | Account |
|---|---|---|---|
| Popular | RD$ 20,000.00 | JUAN ANTONIO RIVERA MART (the user) | `******_2002` |
| BHD | RD$ 20,000.00 | MARIA ALTAGRACIA GOMEZ REYES | `…2002` → `XXXXXX4400` |

One RD$20,000 housing payment. The user moved their own money Popular → their BHD account `2002`, then BHD → Maria. Ingesting both as expenses records RD$40,000.

**Rule:** a transfer is internal **if and only if its destination account is one of the user's own cash accounts.** Nothing else participates in the decision.

The user holds exactly three savings/checking accounts, and internal money movement happens only between these:

| Bank | Last 4 |
|---|---|
| Popular | `2001` |
| BHD | `2002` |
| Banco Santa Cruz | `2003` |

**The beneficiary name must never be used for this decision.** The monthly loan payment to `…3050` carries `Beneficiario: JUAN RIVERA` — the user's own name. A name-based rule would classify it as internal and silently erase a real RD$1,942.10 monthly expense. Ownership of the *counterparty name* and ownership of the *destination as a cash account* are different questions, and only the second one decides.

Applying the rule to every observed transfer:

| Destino | One of the three? | Result |
|---|---|---|
| `…2003` (×2) | yes — Santa Cruz | `internal` |
| `…_2002` (Popular → BHD) | yes — BHD | `internal` |
| `…4400` | no — third party | `external` (housing) |
| `…3050` (×2) | no — a loan, not a cash account | `external` (loan) |
| `…2004`, `…2007` | no | `external` |

Detection reuses the `matchesOwn` helper from `banreservas.parser.ts`, including its digit-boundary rule — which matters here, because `2002`, `2004` and `2007` differ only in the final digit and all appear inside long IBAN-style strings.

**Match the parsed `Producto destino` field, never the whole body.** The BHD origin account is always `…2002`, so a body-wide search would report every BHD email as internal.

### 2. Recurring rules vs email

`repo/src/service/recurring.service.ts` fires daily and creates a transaction unconditionally. Once Phase 1 parses transfer emails, the monthly housing and loan payments arrive from both sources.

A recurring rule is a **prediction**; a bank email is **evidence the money moved**. Where both exist, the email wins.

---

## Transfer classification model

A single new field on `Transaction` replaces what would otherwise be three overlapping booleans:

```ts
transferKind?: 'external' | 'internal' | 'unresolved';
```

| Kind | Counts as expense | Moves balance | Visible | Set when |
|---|---|---|---|---|
| `external` | yes | yes | yes | Destination is **not** one of the three cash accounts |
| `internal` | no | no | yes, tagged | Destination **is** one of the three cash accounts |
| `unresolved` | no | no | yes, flagged | `Producto destino` could not be parsed at all |

`unresolved` is a safety net, not a routine state. Every format observed in the live mailbox resolves deterministically to `internal` or `external`, so the user is not asked to classify anything by hand. It exists so that a template change which breaks destination parsing degrades into "ask the human" rather than "guess and move the balance".

Absent field means an ordinary card transaction — unchanged v1 behaviour.

**Resolution:** the user classifies an `unresolved` transfer in the dashboard as either `internal` (no further effect) or `external` (the expense and the balance are applied **at that moment**). Applying balance on resolution rather than on ingest is what makes "record it without asserting it" safe, and it removes any need for a balance-reversal path.

`BalanceHistory` is written only when balance actually moves, so an `internal` transfer produces no history entry and a resolved `external` one produces exactly one.

---

## Recurring reconciliation

### Matching rule

A transaction and a recurring rule match when **all** hold:

1. Same `userId`
2. Rule is `active`
3. **Amounts are exactly equal** (absolute value). No tolerance — these are fixed payments, and tolerance buys nothing while inviting false positives.
4. The transaction date is within **±3 days** of the rule's `dayOfMonth` for that month
5. The rule has no other transaction already matched in the same calendar month

Rule 5 is what stops a genuine second payment of the same amount from being swallowed.

### Both directions

**Email arrives first (typical).** `IngestionService` persists the transaction and links it: `recurringId` set, and the rule's `lastExecutedAt` advanced to that month. When the cron later reaches the rule's day, it sees the month fulfilled and skips.

**Cron fired first.** The rule created a predicted transaction. The email then **confirms and upgrades it in place** — `sourceMessageId`, `merchant`, `externalRef` and the true `occurredAt` are written onto the existing row. No second transaction, no balance change (the prediction already moved it).

Every match decision is logged at `log` level with both ids, so a wrong match is diagnosable after the fact.

### Salary as recurring income

The `Depósito de Nómina` email carries no amount, so it can only confirm. The user creates a recurring **income** rule for salary; the email confirms the deposit landed and supplies the real date. If no matching rule exists, the email is recognised and skipped — never counted as a parse failure.

### Pre-existing idempotency bug

`processRecurring()` writes `lastExecutedAt` but never reads it. Two runs on the same day — a pod restart, a redeploy — produce two transactions. This predates ingestion and is fixed here: skip any rule already executed in the current calendar month.

---

## Architecture

New and changed files in `api/src/ingestion/`:

- `parsers/bhd.parser.ts` — **becomes a dispatcher.** Discriminate on `Tipo de transacción:` / subject **first**, then delegate to the card-table routine or the new transfer routine. v1's "find any pipe row containing a date" heuristic survives the transfer emails only because a `cells.length < 6` guard happens to reject them; that is an accident, not a decision, and it is replaced.
- `parsers/popular.parser.ts` — same dispatcher treatment: consumption/withdrawal, transfer-sent, transfer-received, nómina, and an explicit known-marketing skip list.
- `parsers/own-party.ts` — `matchesOwn` lifted out of `banreservas.parser.ts` so all four banks share one implementation, digit-boundary rule included.
- `reconciliation.service.ts` — the matching rule above, used by both `IngestionService` and the recurring cron.

Schema additions, mirrored in **both** `api/src/shared/schemas/transaction.schema.ts` and `repo/src/mongodb/schemas/transaction.schemas.ts`:

| Field | Purpose |
|---|---|
| `transferKind?: string` | `'external' \| 'internal' \| 'unresolved'` |
| `recurringId?: string` | Link to the rule this transaction satisfies |

Every site that sums, averages, counts or groups money must exclude `internal` and `unresolved` with `transferKind: { $nin: ['internal', 'unresolved'] }` (`$nin` matches an absent field, which is what keeps ordinary card transactions counting).

> **This list was wrong in the first draft.** It named five sites; a post-review sweep found eleven, and the fix pass found two more inside files already on the list (`cron.notifications.service.ts` `monthlySummary`, `repo` `statistics.service.ts` `getCategoryExpensesForPeriod`) — **thirteen**. The missed ones were found only because a reviewer grepped every `find`/`aggregate` in both services rather than trusting the spec, and then the implementer read each file in full rather than trusting the reviewer's line numbers. Treat the list below as a floor — the test for a new query is "does it sum money?", not "is it on this list?".

| Service | Site | Feeds |
|---|---|---|
| `api` | `transactions.service.ts` — expense listing and CSV export | web list, export |
| `api` | `analytics.service.ts` — top-10, chart totals | dashboard charts |
| `api` | `statistics.service.ts` — summary, monthly, by-category | dashboard |
| `api` | `budget.service.ts` — spent / remaining | budget page |
| `api` | `compare.service.ts` — period summaries | **Mistral prompt** |
| `api` | `tips.service.ts` — 3-month category context | **Mistral prompt** |
| `repo` | `budget.service.ts` — `checkBudget` | `/budget` reply |
| `repo` | `cron.notifications.service.ts` — budget-exceeded cron | push alert (must agree with `/budget`) |
| `repo` | `statistics.service.ts` → `message.service.ts` | bot statistics |
| `repo` | `export.service.ts` | bot CSV |
| `repo` | `advanced.statistics.service.ts` | admin views |

Listings that only *display* rows keep internal/unresolved **visible and tagged** (`transferKind` selected and rendered); exclusion applies to spending totals, not to visibility. The CSV export prints `Type = transfer` and a `Kind` column for them so a spreadsheet sum on `Type = expense` stays correct.

---

## Configuration

One new variable:

```
OWN_CASH_ACCOUNTS=2001,2002,2003
```

The user's savings/checking accounts — Popular, BHD and Santa Cruz respectively. Internal money movement happens only between these.

**This is deliberately separate from the existing `OWN_ACCOUNT_IDENTIFIERS`.** The two answer different questions:

| Variable | Question | Contains | Used by |
|---|---|---|---|
| `OWN_ACCOUNT_IDENTIFIERS` | "Is this party me?" | account digits **and name fragments** | Banreservas income/expense direction |
| `OWN_CASH_ACCOUNTS` | "Is this one of my cash accounts?" | account digits **only** | internal-transfer detection |

Merging them would let a name fragment satisfy the internal-transfer test, which is exactly the bug that erases the loan payment. Keeping them apart makes that mistake impossible rather than merely discouraged.

If `OWN_CASH_ACCOUNTS` is empty, no transfer is ever classified `internal` — transfers are then treated as expenses, which over-reports rather than silently losing money, and is visible in the ledger.

---

## Testing

Each new format gets a parser spec built on the verbatim fixtures above, asserting field extraction and its own date shape. Beyond that:

- `Actualización de Límite` yields `null` — the phantom-RD$25,000 case, asserted explicitly rather than left to the `Aprobada` guard by luck
- `Depósito de Nómina` yields `null` and is classified as *known-skip*, not *failed*
- BHD transfer to `…2003` with subject `…y a otros Bancos` → **`internal`** despite the subject, and asserts **balance is untouched**. This is the phantom-RD$1,000 case.
- BHD transfer to `…3050` with `Beneficiario: JUAN RIVERA` → **`external`**. This is the regression test for the name-based rule that would erase the loan payment.
- BHD transfer to `…4400` (third party) → `external`
- Popular `Pagos al Instante` to `…_2002` → `internal`; to `PEDRO NUÑEZ` → `external`
- `matchesOwn` does not confuse `2002` with `2004` or `2007` inside an IBAN-style string
- Internal detection reads the parsed destination field only — a BHD email whose **origin** is `…2002` and whose destination is a third party is `external`, not `internal`
- A transfer whose destination cannot be parsed → `unresolved`, balance untouched
- Resolving `unresolved` → `external` applies balance exactly once and writes exactly one history entry
- Reconciliation: email-first, cron-first, amount mismatch (no match), date outside window (no match), and a genuine second same-amount payment in one month (**not** swallowed)
- `processRecurring()` run twice in a day creates one transaction

---

## Out of scope

- Cash envelopes / withdrawal itemisation — separate spec, `isWithdrawal` is its seam
- Historical backfill — the forward-only watermark still governs
- Per-account balances. The system has one `Balance`; internal transfers net to zero against it, which is why they need no balance handling at all.

---

## Spec self-review

**Placeholders:** none. Every format, date shape, sender and field rule comes from a verified live sample.

**Internal consistency:** the `transferKind` table matches the resolution flow (balance applied on resolution, never at ingest); the coupling argument at the top matches the out-of-scope note that Phase 1 must not ship alone; the reconciliation rules are the same set used by both directions.

**Ambiguity resolved:** "approved" stays per-bank — status field for card formats, implicit for transfer receipts. "Own party" is defined as beneficiary *and* account both matching, so a same-name third party does not silently become an internal transfer.

**Scope:** one goal — complete format coverage without double-counting. The two phases are coupled by causation and ship together.

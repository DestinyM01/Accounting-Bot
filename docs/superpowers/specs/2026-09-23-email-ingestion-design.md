# Bank Email Ingestion — Design Spec

**Goal:** Automatically turn Dominican bank transaction-notification emails into transactions in the accounting system, removing the need to log card spending by hand.

**Context:** Telegram now charges for messaging in the DR, so the bot is no longer a reliable input channel. Four banks already email every transaction in a structured, machine-parseable form — verified against real mail in `juan.rivera@gmail.com`.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Mail access | **IMAP + Google App Password** | No Google Cloud project or OAuth flow. Runs as a cron inside the existing `api/` container. |
| Review level | **Auto-add; flag category only** | Amount/date/merchant/status parse deterministically, so money is always right. Only the inferred category needs a human. |
| Backfill | **Forward-only** | Backfilling past expenses would subtract them a second time and corrupt the running balance. |
| USD charges | **Convert to DOP at ingest** | Transaction has no currency field; converting keeps the single-currency assumption and avoids touching 11 aggregation sites. Original amount+currency retained for traceability. |
| Host service | **`api/`, not `repo/`** | `api/` is already Telegram-free and already has the Transaction/Balance/Budget/CustomCategory schemas and a Mistral client. |
| Balance history | **Closed — `api/` gets BalanceHistory** | Ingested transactions must produce history entries exactly like bot-entered ones, or the history becomes a partial, misleading record. |
| Banreservas | **In scope, direction-detected** | Wire transfers arrive occasionally and are real income. Direction is derived from `Origen`/`Destino`, never assumed. |

---

## Verified email formats

These are real samples. They are the parser contract and become test fixtures verbatim.

### Banco Popular — `notificaciones@popularenlinea.com`
Subjects: `Notificación de Consumo`, `Notificación de Retiro`. Tab-delimited table.

```
Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 8001.

A continuación detalle de la transacción:

Monto 	Moneda 	Fecha 	Comercio 	Estatus 	
RD$91.42	 Peso dominicano	 11/09/2026 	UBER*RIDES
Aprobada	
```
- Date: `DD/MM/YYYY`, **no time**
- Currency appears twice: symbol prefix (`RD$` / `US$`) and word (`Peso dominicano` / `Dólar`)
- `Notificación de Retiro` replaces `Comercio` with `Cajero Automatico` → **withdrawal**

### BHD — `Alertas@bhd.com.do`
Subject: `BHD Notificación de Transacciones`. Pipe-delimited table.

```
| Fecha | Moneda | Monto | Comercio | Estado | Tipo |
| 18/09/2026 03:11 pm | RD | $460.00 | PedidosYa*Expreso Bonny | Aprobada | Compra |
```
- Date: `DD/MM/YYYY hh:mm am/pm` (**12-hour**)
- Explicit `Tipo` (Compra / Retiro / …)

### Banco Santa Cruz — `notificaciones@bsc.com.do`
Subject: `Notificación, Banco Santa Cruz`. Labeled key-value lines.

```
Te notificamos que desde tu tarjeta de Crédito Gold terminada en 8002
fue realizada la siguiente transacción:

Monto: RD$ 520.00
Lugar de transacción: UBER*EATS SANTO DOMINGODO
Fecha y hora: 21/9/2026 12:32:21
Estado: Aprobada
```
- Date: `D/M/YYYY HH:mm:ss` (**unpadded** day/month, 24-hour)

### Banreservas — `NotificacionesTuBancoApp@banreservas.com`
Subject: `Recibo de la transacción`. Wire/ACH transfer receipts — occasional, and usually **income**. Label and value sit on **separate lines**.

```
| Monto: |
| DOP 1,225.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| CARLOS MANUEL PEREZ SANTOS, CuentaAhorro DOP ** - 4500 |
| Destino: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 0010 |
| Fecha de transacción: |
| 18 de Septiembre 2026 - 11:52 AM |
| Impuestos: |
| DOP 2.45 |
| Número de transacción: |
| 100000000001 |
```

Four things make this parser different from the other three:
- **Value is on the line *after* the label** — not on the same line.
- **Spanish month names**: `18 de Septiembre 2026 - 11:52 AM` — needs a month map.
- **Thousands separator**: `DOP 1,225.00` — must strip commas before parsing.
- **`#concept#`** is an unsubstituted template placeholder (the memo field). Treat as empty, never as a literal description.

It also has **no `Estado` field** — the email *is* the receipt of a completed transfer ("¡Transacción realizada!"), so `approved` is true by construction. The approval gate is therefore **bank-specific**, not global.

`Número de transacción` is captured as a secondary reference (`externalRef`).

---

## Hard rules derived from the real data

1. **Only ingest when the bank says approved.** A Popular email titled "Notificación de Consumo" was found whose body reads *"su transacción ha sido declinada… su tarjeta se encuentra bloqueada."* Subject alone is not sufficient. For Popular/BHD/Santa Cruz the gate is the status field reading `Aprobada`; for Banreservas approval is implicit.
2. **Match senders by exact address, never by domain.** Each bank mixes marketing and transactions across addresses, and Santa Cruz splits across two domains:
   - Popular: `popularteinforma@` (ads) vs `notificaciones@` (real)
   - BHD: `info@` / `servicios@` (ads, statements) vs `Alertas@` (real)
   - Santa Cruz: ads from `servicioalcliente@santacruz.com.do`; transactions from `notificaciones@bsc.com.do`
3. **Never guess transfer direction.** For Banreservas, compare `Destino` and `Origen` against the configured own-account identifiers:
   - own identifier in **Destino** → `income`
   - own identifier in **Origen** → `expense`
   - **neither matches → do not ingest.** Record it for review. Guessing here would silently invent income.
4. **Four different date formats** — one parser each, no shared date logic.
5. **Never silently drop.** An email from an allow-listed sender that fails to parse must be logged loudly and recorded, not ignored.

---

## Architecture

New module `api/src/ingestion/`:

- `mail.client.ts` — IMAP (via `imapflow`); fetches unprocessed messages from the sender allow-list newer than the forward-only watermark.
- `parsers/` — `popular.parser.ts`, `bhd.parser.ts`, `santacruz.parser.ts`, `banreservas.parser.ts`, each implementing a shared `BankParser` interface and returning a normalized `ParsedTransaction` (or `null` when not applicable / not approved / direction unknown).
- `categorizer.service.ts` — merchant → category. Deterministic rules table first (`UBER*EATS`/`PedidosYa` → food, `UBER*RIDES` → transport); Mistral fallback for unknown merchants, which sets `categoryNeedsReview`.
- `ingestion.service.ts` — orchestrates: fetch → parse → gate → dedupe → currency-convert → create transaction → update balance **and record history**.
- `@Cron` poll (adds `@nestjs/schedule` to `api/`).

### Normalized shape

```ts
interface ParsedTransaction {
  bank: 'popular' | 'bhd' | 'santacruz' | 'banreservas';
  direction: 'income' | 'expense';   // never assumed — derived per bank
  amount: number;                    // positive magnitude, commas stripped
  currency: 'DOP' | 'USD';
  occurredAt: Date;
  counterparty: string;              // merchant, or the other party on a transfer
  cardLast4?: string;                // absent on transfers
  isWithdrawal: boolean;             // Popular "Retiro" / BHD Tipo=Retiro
  approved: boolean;
  externalRef?: string;              // Banreservas "Número de transacción"
}
```

Card purchases are always `direction: 'expense'`. Only Banreservas can produce `'income'`.

### Schema additions

Added to **both** `api/src/shared/schemas/transaction.schema.ts` and `repo/src/mongodb/schemas/transaction.schemas.ts` — they back the same MongoDB collection and must stay in sync.

| Field | Purpose |
|---|---|
| `sourceMessageId?: string` | Gmail message id. **Unique sparse index** — the dedupe guarantee. |
| `source?: string` | `'email' \| 'telegram' \| 'manual' \| 'recurring'` |
| `categoryNeedsReview?: boolean` | Drives the review filter |
| `merchant?: string` | Raw counterparty string |
| `cardLast4?: string` | Which card |
| `originalAmount?: number`, `originalCurrency?: string` | USD traceability after conversion |
| `isWithdrawal?: boolean` | Marks ATM withdrawals — the seam the cash-envelope feature attaches to |
| `externalRef?: string` | Bank's own transaction number, where provided |

Dedupe is enforced by the unique index, not by application logic: a duplicate insert throws a duplicate-key error which the service catches and skips.

### Balance and history

Ingested transactions adjust `Balance` (income increments, expense decrements) **and write a `BalanceHistory` entry**, mirroring the bot exactly.

`api/` gains:
- `api/src/shared/schemas/balance-history.schema.ts` — mirrors `repo/`'s (same `BalanceChangeReason` union: `'income' | 'expense' | 'delete' | 'manual' | 'recurring'`, same collection).
- A balance-write path that records history with reason `'income'` or `'expense'`.

The union is **not** extended with an `'email'` reason — provenance is already captured by `source: 'email'` on the Transaction, and changing a shared union would mean touching `repo/` too.

Mirroring the bot, **history-write failures are swallowed and logged** — they must never break the ingestion of a real transaction.

### Configuration

`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `INGEST_POLL_CRON` (default every 10 min), `INGEST_START_AT` (forward-only watermark), `OWN_ACCOUNT_IDENTIFIERS` (comma-separated account last-4s and/or name fragment used for Banreservas direction detection).

**Security:** set up a Gmail filter labelling the four sender addresses, and have the ingester read **only that label** rather than the whole mailbox — this materially shrinks the blast radius of the credential.

---

## Review affordance (web)

"Auto-add, review category only" is meaningless without somewhere to act on the flag. Minimum viable: the transactions page gains a **"Needs review"** filter and inline category assignment, reusing the existing `CategoryService` (which already merges built-in + custom categories).

Income from Banreservas defaults to category `other` with `categoryNeedsReview: true` — a wire could be salary, a reimbursement or a gift, and guessing is worse than asking.

---

## Testing

The parsers are pure functions, and we have **real verified email bodies** for all four banks — those become fixtures. Each parser gets a spec asserting:
- correct field extraction
- correct date parsing for its own format
- `approved: false` for the declined Popular sample
- `isWithdrawal: true` for Retiro mail
- Banreservas: `income` when the user is `Destino`, `expense` when `Origen`, and **null when neither matches**

`repo/` already has jest configured; `api/` needs the same.

---

## Out of scope for v1

- The cash-envelope / withdrawal-itemization model (separate feature, agreed next — `isWithdrawal` is its seam)
- Historical backfill
- Banreservas `Impuestos` (tax line) — captured in raw form but not modelled

---

## Spec self-review

**Placeholders:** none — all formats, senders and field rules come from verified samples.

**Internal consistency:** forward-only agrees with no-backfill; USD conversion agrees with the `originalAmount`/`originalCurrency` fields; "review category only" is matched by `categoryNeedsReview` *and* the web review affordance; the balance-history gap is now closed on both the schema and the write path.

**Ambiguity resolved:** "approved" is defined per-bank (status field for three banks, implicit for Banreservas). Transfer direction is defined by own-account matching, with a hard no-ingest fallback rather than a guess.

**Scope:** one cohesive feature (email → transaction). The cash-envelope model is explicitly deferred.

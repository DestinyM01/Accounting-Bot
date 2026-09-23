# Bank Email Ingestion — Design Spec

**Goal:** Automatically turn Dominican bank transaction-notification emails into transactions in the accounting system, removing the need to log card spending by hand.

**Context:** Telegram now charges for messaging in the DR, so the bot is no longer a reliable input channel. All three banks (plus a fourth) already email every card transaction in a structured, machine-parseable form — verified against real mail in `juan.rivera@gmail.com`.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Mail access | **IMAP + Google App Password** | No Google Cloud project or OAuth flow. Runs as a cron inside the existing `api/` container. |
| Review level | **Auto-add; flag category only** | Amount/date/merchant/status parse deterministically, so money is always right. Only the inferred category needs a human. |
| Backfill | **Forward-only** | Backfilling past expenses would subtract them a second time and corrupt the running balance. |
| USD charges | **Convert to DOP at ingest** | Transaction has no currency field; converting keeps the single-currency assumption and avoids touching 11 aggregation sites. Original amount+currency retained for traceability. |
| Host service | **`api/`, not `repo/`** | `api/` is already Telegram-free and already has the Transaction/Balance/Budget/CustomCategory schemas and a Mistral client. |

---

## Verified email formats

These are real samples. They are the parser contract and should become test fixtures verbatim.

### Banco Popular — `notificaciones@popularenlinea.com`
Subjects: `Notificación de Consumo`, `Notificación de Retiro`. Tab-delimited table in the plain-text body.

```
Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 8001.

A continuación detalle de la transacción:

Monto 	Moneda 	Fecha 	Comercio 	Estatus 	
RD$91.42	 Peso dominicano	 11/09/2026 	UBER*RIDES
Aprobada	
```
- Date: `DD/MM/YYYY`, **no time**
- Currency appears twice: symbol prefix (`RD$` / `US$`) and word (`Peso dominicano` / `Dólar`)
- `Notificación de Retiro` replaces the `Comercio` column with `Cajero Automatico` → treat as a **withdrawal**

### BHD — `Alertas@bhd.com.do`
Subject: `BHD Notificación de Transacciones`. Pipe-delimited table.

```
| Fecha | Moneda | Monto | Comercio | Estado | Tipo |
| 18/09/2026 03:11 pm | RD | $460.00 | PedidosYa*Expreso Bonny | Aprobada | Compra |
```
- Date: `DD/MM/YYYY hh:mm am/pm` (**12-hour**)
- Richest format — includes an explicit `Tipo` (Compra / Retiro / …)

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

### Banreservas — out of scope for v1
`NotificacionesTuBancoApp@banreservas.com` sends ACH transfer receipts that appear to be **incoming** money ("Origen: …"), i.e. income, not expenses. Different semantics; deferred. Its bodies also contain unsubstituted `#concept#` template placeholders.

---

## Hard rules derived from the real data

1. **Only ingest when status is `Aprobada`.** A Popular email titled "Notificación de Consumo" was found whose body reads *"su transacción ha sido declinada… su tarjeta se encuentra bloqueada."* Subject alone is not sufficient.
2. **Match senders by exact address, never by domain.** Each bank mixes marketing and transactions across addresses, and Santa Cruz splits across two domains:
   - Popular: `popularteinforma@` (ads) vs `notificaciones@` (real)
   - BHD: `info@` / `servicios@` (ads, statements) vs `Alertas@` (real)
   - Santa Cruz: ads from `servicioalcliente@santacruz.com.do`; transactions from `notificaciones@bsc.com.do`
3. **Three different date formats** — one parser each, no shared date logic.
4. **Never silently drop.** An email from an allow-listed sender that fails to parse must be logged loudly and recorded, not ignored.

---

## Architecture

New module `api/src/ingestion/`:

- `mail.client.ts` — IMAP (via `imapflow`); fetches unprocessed messages from the sender allow-list newer than the forward-only watermark.
- `parsers/` — `popular.parser.ts`, `bhd.parser.ts`, `santacruz.parser.ts`, each implementing a shared `BankParser` interface returning a normalized `ParsedTransaction` (or `null` if not applicable / not approved).
- `categorizer.service.ts` — merchant → category. Deterministic rules table first (e.g. `UBER*EATS`/`PedidosYa` → food, `UBER*RIDES` → transport); Mistral fallback for unknown merchants, which sets `categoryNeedsReview`.
- `ingestion.service.ts` — orchestrates: fetch → parse → reject non-approved → dedupe → currency-convert → create transaction → update balance.
- `@Cron` poll (adds `@nestjs/schedule` to `api/`).

### Normalized shape

```ts
interface ParsedTransaction {
  bank: 'popular' | 'bhd' | 'santacruz';
  amount: number;          // positive magnitude
  currency: 'DOP' | 'USD';
  occurredAt: Date;
  merchant: string;
  cardLast4: string;
  isWithdrawal: boolean;   // Popular "Retiro" / BHD Tipo=Retiro
  approved: boolean;       // must be true to ingest
}
```

### Schema additions

Added to **both** `api/src/shared/schemas/transaction.schema.ts` and `repo/src/mongodb/schemas/transaction.schemas.ts` — they back the same MongoDB collection and must stay in sync.

| Field | Purpose |
|---|---|
| `sourceMessageId?: string` | Gmail message id. **Unique sparse index** — the dedupe guarantee. |
| `source?: string` | `'email' \| 'telegram' \| 'manual' \| 'recurring'` |
| `categoryNeedsReview?: boolean` | Drives the review filter |
| `merchant?: string` | Raw merchant string |
| `cardLast4?: string` | Which card |
| `originalAmount?: number`, `originalCurrency?: string` | USD traceability after conversion |
| `isWithdrawal?: boolean` | Marks ATM withdrawals — the hook the cash-envelope feature will build on |

Dedupe is enforced by the unique index, not by application logic: a duplicate insert throws a duplicate-key error which the service catches and skips.

### Balance

Ingested expenses decrement `Balance`, mirroring the bot's behaviour. `api/` currently has no balance write path, so a minimal one is added. **Note:** `api/` has no `BalanceHistory` schema, so ingested transactions will not produce history entries in v1 (the bot's do). Flagged as a known inconsistency, deferred.

### Configuration

`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `INGEST_POLL_CRON` (default every 10 min), `INGEST_START_AT` (forward-only watermark).

**Security:** set up a Gmail filter labelling the three sender addresses, and have the ingester read **only that label** rather than the whole mailbox — this materially shrinks the blast radius of the credential.

---

## Review affordance (web)

"Auto-add, review category only" is meaningless without somewhere to act on the flag. Minimum viable: the transactions page gains a **"Needs review"** filter and inline category assignment, reusing the existing `CategoryService` (which already merges built-in + custom categories).

---

## Testing

The parsers are pure functions, and we have **real verified email bodies** — those become fixtures. Each parser gets a spec asserting: correct field extraction, correct date parsing for its format, `approved: false` for declined mail, and `isWithdrawal` for Retiro mail. `repo/` already has jest configured; `api/` needs the same.

---

## Out of scope for v1

- Banreservas ACH ingestion (income semantics)
- The cash-envelope / withdrawal-itemization model (separate feature, agreed next)
- Historical backfill
- `BalanceHistory` entries for ingested transactions

---

## Spec self-review

**Placeholders:** none — all formats, senders and field rules come from verified samples.

**Internal consistency:** the forward-only decision and the no-backfill scope agree; the USD conversion decision and the `originalAmount`/`originalCurrency` fields agree; the "review category only" decision is matched by the `categoryNeedsReview` field *and* the web review affordance.

**Ambiguity resolved:** "approved" is defined strictly as the bank's own status field reading `Aprobada`, not inferred from subject.

**Scope:** one cohesive feature (email → transaction). The cash-envelope model is explicitly deferred, and `isWithdrawal` is the seam it will attach to.

# Bank Email Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll Gmail over IMAP, parse Dominican bank transaction-notification emails from four banks, and create transactions (with balance + history updates) automatically.

**Architecture:** A new `api/src/ingestion/` module. Parsers are **pure functions** tested against real captured email bodies. Dedupe is enforced by a unique Mongo index, not application logic. Card purchases are always expenses; only Banreservas can produce income, and its direction is detected from `Origen`/`Destino`, never assumed.

**Tech Stack:** NestJS (`api/`) · imapflow · @nestjs/schedule · Mistral (already wired) · Mongoose · jest (already configured in `api/`)

**Spec:** `docs/superpowers/specs/2026-09-23-email-ingestion-design.md`

---

## File map

| File | Task | Change |
|---|---|---|
| `api/src/shared/schemas/transaction.schema.ts` | E1 | +8 ingestion fields, unique sparse index |
| `repo/src/mongodb/schemas/transaction.schemas.ts` | E1 | Same fields (shared collection — must not drift) |
| `api/src/shared/schemas/balance-history.schema.ts` | E1 | **NEW** — mirrors `repo/`'s |
| `api/src/ingestion/parsers/types.ts` | E2 | **NEW** — `ParsedTransaction`, `BankParser` |
| `api/src/ingestion/parsers/dates.ts` | E2 | **NEW** — four date parsers |
| `api/src/ingestion/parsers/popular.parser.ts` (+spec) | E2 | **NEW** |
| `api/src/ingestion/parsers/bhd.parser.ts` (+spec) | E3 | **NEW** |
| `api/src/ingestion/parsers/santacruz.parser.ts` (+spec) | E3 | **NEW** |
| `api/src/ingestion/parsers/banreservas.parser.ts` (+spec) | E4 | **NEW** — direction detection |
| `api/src/ingestion/categorizer.service.ts` | E5 | **NEW** — rules + Mistral fallback |
| `api/src/ingestion/fx.service.ts` | E6 | **NEW** — USD→DOP |
| `api/src/ingestion/mail.client.ts` | E7 | **NEW** — IMAP |
| `api/src/ingestion/ingestion.service.ts` + `.module.ts` | E8 | **NEW** — orchestrator + cron |
| `api/src/app.module.ts` | E8 | Import IngestionModule + ScheduleModule |
| `web/` transactions page | E9 | "Needs review" filter + inline category set |

---

## Task E1 — Schema additions + BalanceHistory in `api/`

**Files:**
- Modify: `api/src/shared/schemas/transaction.schema.ts`
- Modify: `repo/src/mongodb/schemas/transaction.schemas.ts`
- Create: `api/src/shared/schemas/balance-history.schema.ts`

**Why both transaction schemas:** they back the same MongoDB collection. If they drift, one service silently strips fields the other wrote.

- [ ] **Step 1: Add fields to `api/src/shared/schemas/transaction.schema.ts`**

  Add inside the `Transaction` class, after the existing `category` prop:
  ```typescript
    @Prop({ index: { unique: true, sparse: true } }) sourceMessageId?: string;
    @Prop() source?: string;                 // 'email' | 'telegram' | 'manual' | 'recurring'
    @Prop() categoryNeedsReview?: boolean;
    @Prop() merchant?: string;
    @Prop() cardLast4?: string;
    @Prop() originalAmount?: number;
    @Prop() originalCurrency?: string;
    @Prop() isWithdrawal?: boolean;
    @Prop() externalRef?: string;
  ```

- [ ] **Step 2: Add the same fields to `repo/src/mongodb/schemas/transaction.schemas.ts`**

  Use the repo file's multi-line `@Prop()` style:
  ```typescript
    @Prop({ index: { unique: true, sparse: true } })
    sourceMessageId?: string;

    @Prop()
    source?: string;

    @Prop()
    categoryNeedsReview?: boolean;

    @Prop()
    merchant?: string;

    @Prop()
    cardLast4?: string;

    @Prop()
    originalAmount?: number;

    @Prop()
    originalCurrency?: string;

    @Prop()
    isWithdrawal?: boolean;

    @Prop()
    externalRef?: string;
  ```

- [ ] **Step 3: Create `api/src/shared/schemas/balance-history.schema.ts`**

  Mirrors `repo/src/mongodb/schemas/balance-history.schemas.ts` exactly (same collection, same reason union):
  ```typescript
  import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
  import { Document } from 'mongoose';

  export type BalanceChangeReason = 'income' | 'expense' | 'delete' | 'manual' | 'recurring';

  @Schema()
  export class BalanceHistory extends Document {
    @Prop({ required: true }) userId: number;
    @Prop({ required: true }) previousBalance: number;
    @Prop({ required: true }) newBalance: number;
    @Prop({ required: true }) delta: number;
    @Prop({ required: true }) reason: BalanceChangeReason;
    @Prop() transactionName?: string;
    @Prop() transactionId?: string;
    @Prop({ required: true, default: Date.now }) timestamp: Date;
  }

  export const BalanceHistorySchema = SchemaFactory.createForClass(BalanceHistory);
  ```

- [ ] **Step 4: Build both services**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5
  cd ../repo && npm run build 2>&1 | tail -5
  ```
  Expected: both clean.

- [ ] **Step 5: Commit**

  ```bash
  git add api/src/shared/schemas/ repo/src/mongodb/schemas/transaction.schemas.ts
  git commit -m "feat(schemas): add ingestion fields and BalanceHistory to api"
  ```

---

## Task E2 — Parser contract + date helpers + Popular parser

**Files:**
- Create: `api/src/ingestion/parsers/types.ts`
- Create: `api/src/ingestion/parsers/dates.ts`
- Create: `api/src/ingestion/parsers/popular.parser.ts`
- Create: `api/src/ingestion/parsers/popular.parser.spec.ts`

- [ ] **Step 1: Create `types.ts`**

  ```typescript
  export type Bank = 'popular' | 'bhd' | 'santacruz' | 'banreservas';

  export interface ParsedTransaction {
    bank: Bank;
    direction: 'income' | 'expense';
    amount: number;              // positive magnitude, commas stripped
    currency: 'DOP' | 'USD';
    occurredAt: Date;
    counterparty: string;        // merchant, or the other party on a transfer
    cardLast4?: string;
    isWithdrawal: boolean;
    approved: boolean;
    externalRef?: string;
  }

  export interface ParseInput {
    subject: string;
    body: string;
    /** Own account last-4s / name fragments, for transfer direction detection. */
    ownIdentifiers?: string[];
  }

  export interface BankParser {
    readonly bank: Bank;
    /** Exact lowercased sender addresses this parser claims. */
    readonly senders: string[];
    /** Returns null when unusable: declined, unparseable, or direction unknown. */
    parse(input: ParseInput): ParsedTransaction | null;
  }

  /** "1,225.00" | "91.42" -> number. Returns NaN when unparseable. */
  export function toAmount(raw: string): number {
    return parseFloat(raw.replace(/,/g, ''));
  }
  ```

- [ ] **Step 2: Create `dates.ts`**

  ```typescript
  const SPANISH_MONTHS: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
    noviembre: 10, diciembre: 11,
  };

  /** Popular: "11/09/2026" (no time) */
  export function parseDdMmYyyy(s: string): Date | null {
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  /** BHD: "18/09/2026 03:11 pm" (12-hour) */
  export function parseDdMmYyyy12h(s: string): Date | null {
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (!m) return parseDdMmYyyy(s);
    let hour = +m[4] % 12;
    if (m[6].toLowerCase() === 'pm') hour += 12;
    return new Date(+m[3], +m[2] - 1, +m[1], hour, +m[5]);
  }

  /** Santa Cruz: "21/9/2026 12:32:21" (unpadded, 24-hour) */
  export function parseDMyHms(s: string): Date | null {
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return parseDdMmYyyy(s);
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  }

  /** Banreservas: "18 de Septiembre 2026 - 11:52 AM" */
  export function parseSpanishLongDate(s: string): Date | null {
    const m = s.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
    if (!m) return null;
    const month = SPANISH_MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    let hour = m[4] ? +m[4] % 12 : 0;
    if (m[6]?.toUpperCase() === 'PM') hour += 12;
    return new Date(+m[3], month, +m[1], hour, m[5] ? +m[5] : 0);
  }
  ```

- [ ] **Step 3: Create `popular.parser.ts`**

  Uses targeted regexes rather than column positions, because the values row wraps across lines in real mail.
  ```typescript
  import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
  import { parseDdMmYyyy } from './dates';

  export const popularParser: BankParser = {
    bank: 'popular',
    senders: ['notificaciones@popularenlinea.com'],

    parse({ subject, body }: ParseInput): ParsedTransaction | null {
      // Declined mail reuses the "Notificación de Consumo" subject — bail hard.
      if (/declinad/i.test(body)) return null;

      const amountM = body.match(/(RD\$|US\$)\s*([\d.,]+)/);
      const dateM   = body.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      const statusM = body.match(/\b(Aprobada)\b/i);
      if (!amountM || !dateM || !statusM) return null;

      const occurredAt = parseDdMmYyyy(dateM[1]);
      if (!occurredAt) return null;

      const isWithdrawal =
        /Retiro/i.test(subject) || /Cajero\s+Autom[áa]tico/i.test(body);

      // Merchant sits between the date and the status word.
      const start = (dateM.index ?? 0) + dateM[1].length;
      const end   = statusM.index ?? body.length;
      const counterparty =
        body.slice(start, end).replace(/[|\t\r\n]+/g, ' ').trim() ||
        (isWithdrawal ? 'Cajero Automatico' : 'Desconocido');

      const cardM = body.match(/terminada en\s*(\d{4})/i);

      return {
        bank: 'popular',
        direction: 'expense',
        amount: toAmount(amountM[2]),
        currency: amountM[1] === 'US$' ? 'USD' : 'DOP',
        occurredAt,
        counterparty,
        cardLast4: cardM?.[1],
        isWithdrawal,
        approved: true,
      };
    },
  };
  ```

- [ ] **Step 4: Create `popular.parser.spec.ts` with the real captured bodies**

  ```typescript
  import { popularParser } from './popular.parser';

  const CONSUMO = `Estimado (a)

  Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 8001.

  A continuación detalle de la transacción:

  Monto \tMoneda \tFecha \tComercio \tEstatus \t
  RD$91.42\t Peso dominicano\t 11/09/2026 \tUBER*RIDES
  Aprobada\t

  En caso de requerir mayor información, puede comunicarse con nosotros`;

  const RETIRO = `Estimado (a)

  Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 8001.

  A continuación detalle de la transacción:

  Monto \tMoneda \tFecha \tCajero Automatico \tEstatus \t
  RD$1600.00\t Peso dominicano\t 19/09/2026 \tCajero Automatico
  Aprobada\t`;

  const USD = `Gracias por utilizar su VISA ISI, terminada en 8316.
  Monto \tMoneda \tFecha \tComercio \tEstatus \t
  US$20.00\t Dólar\t 09/09/2026 \tOPENAI
  Aprobada\t`;

  const DECLINADA = `Estimado (a) JUAN ANTONIO RIVERA MARTE
  Gracias por utilizar su VISA ISI, terminada en 8316.
  Le informamos que su transacción ha sido declinada por razones de seguridad,
  su tarjeta se encuentra bloqueada`;

  describe('popularParser', () => {
    it('parses an approved purchase', () => {
      const r = popularParser.parse({ subject: 'Notificación de Consumo', body: CONSUMO })!;
      expect(r).not.toBeNull();
      expect(r.amount).toBe(91.42);
      expect(r.currency).toBe('DOP');
      expect(r.direction).toBe('expense');
      expect(r.counterparty).toBe('UBER*RIDES');
      expect(r.cardLast4).toBe('8001');
      expect(r.isWithdrawal).toBe(false);
      expect(r.occurredAt.getFullYear()).toBe(2026);
      expect(r.occurredAt.getMonth()).toBe(8); // September
      expect(r.occurredAt.getDate()).toBe(11);
    });

    it('flags ATM withdrawals', () => {
      const r = popularParser.parse({ subject: 'Notificación de Retiro', body: RETIRO })!;
      expect(r.isWithdrawal).toBe(true);
      expect(r.amount).toBe(1600);
    });

    it('detects USD charges', () => {
      const r = popularParser.parse({ subject: 'Notificación de Consumo', body: USD })!;
      expect(r.currency).toBe('USD');
      expect(r.amount).toBe(20);
    });

    it('returns null for a declined transaction', () => {
      expect(popularParser.parse({ subject: 'Notificación de Consumo', body: DECLINADA })).toBeNull();
    });
  });
  ```

- [ ] **Step 5: Run the spec**

  ```bash
  cd api && npx jest popular.parser 2>&1 | tail -15
  ```
  Expected: 4 passing.

- [ ] **Step 6: Commit**

  ```bash
  git add api/src/ingestion/parsers/
  git commit -m "feat(ingestion): add parser contract, date helpers and Popular parser"
  ```

---

## Task E3 — BHD and Santa Cruz parsers

**Files:**
- Create: `api/src/ingestion/parsers/bhd.parser.ts` (+ `.spec.ts`)
- Create: `api/src/ingestion/parsers/santacruz.parser.ts` (+ `.spec.ts`)

- [ ] **Step 1: Create `bhd.parser.ts`**

  ```typescript
  import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
  import { parseDdMmYyyy12h } from './dates';

  export const bhdParser: BankParser = {
    bank: 'bhd',
    senders: ['alertas@bhd.com.do'],

    parse({ body }: ParseInput): ParsedTransaction | null {
      // The data row is the pipe row containing a date (the header row has none).
      const row = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('|') && /\d{1,2}\/\d{1,2}\/\d{4}/.test(l));
      if (!row) return null;

      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 6) return null;
      const [fecha, moneda, monto, comercio, estado, tipo] = cells;

      if (!/aprobada/i.test(estado)) return null;

      const occurredAt = parseDdMmYyyy12h(fecha);
      const amount = toAmount(monto.replace(/\$/g, ''));
      if (!occurredAt || isNaN(amount)) return null;

      const cardM = body.match(/#\s*(\d{4})/);

      return {
        bank: 'bhd',
        direction: 'expense',
        amount,
        currency: /US/i.test(moneda) ? 'USD' : 'DOP',
        occurredAt,
        counterparty: comercio,
        cardLast4: cardM?.[1],
        isWithdrawal: /retiro/i.test(tipo),
        approved: true,
      };
    },
  };
  ```

- [ ] **Step 2: Create `bhd.parser.spec.ts`**

  ```typescript
  import { bhdParser } from './bhd.parser';

  const COMPRA = `| BHD Notificación de Transacciones Visa Débito Intl # 5875 Detalle de Criterios |
  | Fecha | Moneda | Monto | Comercio | Estado | Tipo |
  | 18/09/2026 03:11 pm | RD | $460.00 | PedidosYa*Expreso Bonny | Aprobada | Compra |`;

  const DECLINADA = `| Fecha | Moneda | Monto | Comercio | Estado | Tipo |
  | 18/09/2026 03:11 pm | RD | $460.00 | ALGO | Declinada | Compra |`;

  describe('bhdParser', () => {
    it('parses an approved purchase with 12-hour time', () => {
      const r = bhdParser.parse({ subject: 'BHD Notificación de Transacciones', body: COMPRA })!;
      expect(r.amount).toBe(460);
      expect(r.currency).toBe('DOP');
      expect(r.counterparty).toBe('PedidosYa*Expreso Bonny');
      expect(r.cardLast4).toBe('5875');
      expect(r.isWithdrawal).toBe(false);
      expect(r.occurredAt.getHours()).toBe(15); // 03:11 pm
      expect(r.occurredAt.getMinutes()).toBe(11);
    });

    it('returns null when not approved', () => {
      expect(bhdParser.parse({ subject: 'x', body: DECLINADA })).toBeNull();
    });
  });
  ```

- [ ] **Step 3: Create `santacruz.parser.ts`**

  ```typescript
  import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
  import { parseDMyHms } from './dates';

  export const santaCruzParser: BankParser = {
    bank: 'santacruz',
    senders: ['notificaciones@bsc.com.do'],

    parse({ body }: ParseInput): ParsedTransaction | null {
      const estadoM = body.match(/Estado:\s*(\w+)/i);
      if (!estadoM || !/aprobada/i.test(estadoM[1])) return null;

      const amountM = body.match(/Monto:\s*(RD\$|US\$)\s*([\d.,]+)/i);
      const placeM  = body.match(/Lugar de transacci[óo]n:\s*(.+)/i);
      const dateM   = body.match(/Fecha y hora:\s*(.+)/i);
      if (!amountM || !dateM) return null;

      const occurredAt = parseDMyHms(dateM[1].trim());
      if (!occurredAt) return null;

      const cardM = body.match(/terminada en\s*(\d{4})/i);

      return {
        bank: 'santacruz',
        direction: 'expense',
        amount: toAmount(amountM[2]),
        currency: amountM[1] === 'US$' ? 'USD' : 'DOP',
        occurredAt,
        counterparty: placeM?.[1].trim() ?? 'Desconocido',
        cardLast4: cardM?.[1],
        isWithdrawal: /cajero/i.test(placeM?.[1] ?? ''),
        approved: true,
      };
    },
  };
  ```

- [ ] **Step 4: Create `santacruz.parser.spec.ts`**

  ```typescript
  import { santaCruzParser } from './santacruz.parser';

  const CONSUMO = `NOTIFICACIÓN DE consumo

  Te notificamos que desde tu tarjeta de Crédito Gold terminada en 8002
  fue realizada la siguiente transacción:

  Monto: RD$ 520.00
  Lugar de transacción: UBER*EATS SANTO DOMINGODO
  Fecha y hora: 21/9/2026 12:32:21
  Estado: Aprobada`;

  describe('santaCruzParser', () => {
    it('parses an approved purchase with unpadded date', () => {
      const r = santaCruzParser.parse({ subject: 'Notificación, Banco Santa Cruz', body: CONSUMO })!;
      expect(r.amount).toBe(520);
      expect(r.counterparty).toBe('UBER*EATS SANTO DOMINGODO');
      expect(r.cardLast4).toBe('8002');
      expect(r.occurredAt.getDate()).toBe(21);
      expect(r.occurredAt.getMonth()).toBe(8);
      expect(r.occurredAt.getHours()).toBe(12);
    });

    it('returns null when not approved', () => {
      expect(
        santaCruzParser.parse({ subject: 'x', body: CONSUMO.replace('Aprobada', 'Declinada') }),
      ).toBeNull();
    });
  });
  ```

- [ ] **Step 5: Run both specs**

  ```bash
  cd api && npx jest bhd.parser santacruz.parser 2>&1 | tail -15
  ```
  Expected: all passing.

- [ ] **Step 6: Commit**

  ```bash
  git add api/src/ingestion/parsers/
  git commit -m "feat(ingestion): add BHD and Santa Cruz parsers"
  ```

---

## Task E4 — Banreservas parser (direction detection)

**Files:**
- Create: `api/src/ingestion/parsers/banreservas.parser.ts` (+ `.spec.ts`)

**Critical rule:** if neither `Origen` nor `Destino` matches an own identifier, return `null`. Guessing would invent income.

- [ ] **Step 1: Create `banreservas.parser.ts`**

  ```typescript
  import { BankParser, ParseInput, ParsedTransaction, toAmount } from './types';
  import { parseSpanishLongDate } from './dates';

  /** Banreservas puts the label on one line and its value on the NEXT line. */
  function valueAfter(lines: string[], label: string): string | null {
    const i = lines.findIndex((l) => l.toLowerCase().startsWith(label.toLowerCase()));
    if (i < 0) return null;
    const v = lines[i + 1];
    return v && !v.endsWith(':') ? v : null;
  }

  function matchesOwn(value: string | null, ownIdentifiers: string[]): boolean {
    if (!value) return false;
    const hay = value.toLowerCase();
    return ownIdentifiers.some((id) => id.trim() && hay.includes(id.trim().toLowerCase()));
  }

  export const banreservasParser: BankParser = {
    bank: 'banreservas',
    senders: ['notificacionestubancoapp@banreservas.com'],

    parse({ body, ownIdentifiers = [] }: ParseInput): ParsedTransaction | null {
      const lines = body
        .split('\n')
        .map((l) => l.replace(/\|/g, '').trim())
        .filter(Boolean);

      const montoRaw = valueAfter(lines, 'Monto:');
      const origen   = valueAfter(lines, 'Origen:');
      const destino  = valueAfter(lines, 'Destino:');
      const fechaRaw = valueAfter(lines, 'Fecha de transacción:');
      const refRaw   = valueAfter(lines, 'Número de transacción:');
      if (!montoRaw || !fechaRaw) return null;

      // "DOP 1,225.00"
      const amountM = montoRaw.match(/([A-Z]{3})\s*([\d.,]+)/);
      if (!amountM) return null;
      const amount = toAmount(amountM[2]);
      if (isNaN(amount)) return null;

      const occurredAt = parseSpanishLongDate(fechaRaw);
      if (!occurredAt) return null;

      // Direction is DETECTED, never assumed. Unknown => do not ingest.
      let direction: 'income' | 'expense';
      let counterparty: string;
      if (matchesOwn(destino, ownIdentifiers)) {
        direction = 'income';
        counterparty = origen?.split(',')[0]?.trim() ?? 'Transferencia';
      } else if (matchesOwn(origen, ownIdentifiers)) {
        direction = 'expense';
        counterparty = destino?.split(',')[0]?.trim() ?? 'Transferencia';
      } else {
        return null;
      }

      return {
        bank: 'banreservas',
        direction,
        amount,
        currency: amountM[1] === 'USD' ? 'USD' : 'DOP',
        occurredAt,
        counterparty,
        isWithdrawal: false,
        approved: true, // the email IS the receipt; no status field exists
        externalRef: refRaw ?? undefined,
      };
    },
  };
  ```

- [ ] **Step 2: Create `banreservas.parser.spec.ts`**

  ```typescript
  import { banreservasParser } from './banreservas.parser';

  const RECEIPT = `| ¡Transacción realizada! |
  | Monto: |
  | DOP 1,225.00 |
  | #concept# |
  | Transacción: |
  | Transferencia ACH |
  | Origen: |
  | CARLOS MANUEL PEREZ SANTOS, CuentaAhorro DOP ** - 4500 |
  | Destino: |
  | JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2002 |
  | Fecha de transacción: |
  | 18 de Septiembre 2026 - 11:52 AM |
  | Impuestos: |
  | DOP 2.45 |
  | Número de transacción: |
  | 100000000001 |`;

  const OWN = ['2002', 'JUAN ANTONIO RIVERA MARTE'];

  describe('banreservasParser', () => {
    it('books an incoming wire as income and strips the thousands separator', () => {
      const r = banreservasParser.parse({ subject: 'Recibo de la transacción', body: RECEIPT, ownIdentifiers: OWN })!;
      expect(r.direction).toBe('income');
      expect(r.amount).toBe(1225);
      expect(r.counterparty).toBe('CARLOS MANUEL PEREZ SANTOS');
      expect(r.externalRef).toBe('100000000001');
    });

    it('parses the Spanish long date', () => {
      const r = banreservasParser.parse({ subject: 'x', body: RECEIPT, ownIdentifiers: OWN })!;
      expect(r.occurredAt.getDate()).toBe(18);
      expect(r.occurredAt.getMonth()).toBe(8); // Septiembre
      expect(r.occurredAt.getHours()).toBe(11);
    });

    it('books an outgoing wire as an expense', () => {
      const outgoing = RECEIPT
        .replace('CARLOS MANUEL PEREZ SANTOS, CuentaAhorro DOP ** - 4500', 'JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2002')
        .replace('JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 2002 |\n  | Fecha', 'ALGUIEN MAS, CuentaAhorro DOP ** - 9999 |\n  | Fecha');
      const r = banreservasParser.parse({ subject: 'x', body: outgoing, ownIdentifiers: OWN })!;
      expect(r.direction).toBe('expense');
    });

    it('returns null when neither party matches — never guesses direction', () => {
      expect(
        banreservasParser.parse({ subject: 'x', body: RECEIPT, ownIdentifiers: ['9999'] }),
      ).toBeNull();
    });

    it('treats #concept# as a placeholder, not a description', () => {
      const r = banreservasParser.parse({ subject: 'x', body: RECEIPT, ownIdentifiers: OWN })!;
      expect(r.counterparty).not.toContain('#concept#');
    });
  });
  ```

- [ ] **Step 3: Run the spec**

  ```bash
  cd api && npx jest banreservas.parser 2>&1 | tail -20
  ```
  Expected: all passing. If the "outgoing" fixture manipulation proves brittle, build that fixture as its own explicit string instead of string-replacing — the assertion that matters is `direction === 'expense'`.

- [ ] **Step 4: Commit**

  ```bash
  git add api/src/ingestion/parsers/
  git commit -m "feat(ingestion): add Banreservas parser with direction detection"
  ```

---

## Task E5 — Categorizer (rules + Mistral fallback)

**Files:**
- Create: `api/src/ingestion/categorizer.service.ts` (+ `.spec.ts`)

**Pattern:** mirror `api/src/tips/tips.service.ts` — lazy `new Mistral({ apiKey: process.env.MISTRAL_API_KEY })`, model `mistral-small-latest`, errors logged and swallowed with a safe fallback.

- [ ] **Step 1: Create `categorizer.service.ts`**

  ```typescript
  import { Injectable, Logger } from '@nestjs/common';
  import { Mistral } from '@mistralai/mistralai';

  export interface CategoryResult {
    category: string;
    needsReview: boolean;
  }

  /** Deterministic rules run first — free, instant, and predictable. */
  const RULES: { pattern: RegExp; category: string }[] = [
    { pattern: /uber\s*\*?\s*eats|pedidosya|didi\s*food/i, category: 'food' },
    { pattern: /uber|didi|taxi|parqueo|gasolin|shell|texaco/i, category: 'transport' },
    { pattern: /supermercado|nacional|jumbo|sirena|bravo|pricesmart/i, category: 'food' },
    { pattern: /farmacia|carol|gbc|hospital|clinic/i, category: 'health' },
    { pattern: /edenorte|edesur|edeeste|claro|altice|viva|agua/i, category: 'housing' },
    { pattern: /netflix|spotify|hbo|disney|cine|steam/i, category: 'entertainment' },
    { pattern: /cajero\s+autom/i, category: 'other' },
  ];

  @Injectable()
  export class CategorizerService {
    private readonly logger = new Logger(CategorizerService.name);
    private client: Mistral | null = null;

    /** Rules first; Mistral only for unknown merchants. */
    async categorize(counterparty: string, allowed: string[]): Promise<CategoryResult> {
      for (const rule of RULES) {
        if (rule.pattern.test(counterparty)) {
          return { category: rule.category, needsReview: false };
        }
      }
      const guess = await this.askMistral(counterparty, allowed);
      return guess
        ? { category: guess, needsReview: true }
        : { category: 'other', needsReview: true };
    }

    private async askMistral(counterparty: string, allowed: string[]): Promise<string | null> {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) return null;
      try {
        this.client ??= new Mistral({ apiKey });
        const res = await this.client.chat.complete({
          model: 'mistral-small-latest',
          messages: [
            {
              role: 'user',
              content:
                `Classify this Dominican Republic merchant into exactly one category.\n` +
                `Merchant: "${counterparty}"\n` +
                `Allowed categories: ${allowed.join(', ')}\n` +
                `Reply with ONLY the category name, nothing else.`,
            },
          ],
        });
        const raw = res.choices?.[0]?.message?.content;
        const text = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
        return allowed.includes(text) ? text : null;
      } catch (err) {
        this.logger.error('Mistral categorization failed', err instanceof Error ? err.stack : String(err));
        return null;
      }
    }
  }
  ```

- [ ] **Step 2: Create `categorizer.service.spec.ts` (rules only — no network)**

  ```typescript
  import { CategorizerService } from './categorizer.service';

  describe('CategorizerService rules', () => {
    const svc = new CategorizerService();
    const allowed = ['food', 'transport', 'housing', 'health', 'entertainment', 'salary', 'savings', 'other'];

    it.each([
      ['UBER*EATS SANTO DOMINGODO', 'food'],
      ['PedidosYa*Expreso Bonny', 'food'],
      ['UBER*RIDES', 'transport'],
      ['Cajero Automatico', 'other'],
    ])('classifies %s as %s without calling Mistral', async (merchant, expected) => {
      const r = await svc.categorize(merchant, allowed);
      expect(r.category).toBe(expected);
      expect(r.needsReview).toBe(false);
    });

    it('falls back to other+needsReview for an unknown merchant with no API key', async () => {
      const prev = process.env.MISTRAL_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      const r = await svc.categorize('ZZZ UNKNOWN MERCHANT', allowed);
      expect(r.category).toBe('other');
      expect(r.needsReview).toBe(true);
      if (prev) process.env.MISTRAL_API_KEY = prev;
    });
  });
  ```

- [ ] **Step 3: Run and commit**

  ```bash
  cd api && npx jest categorizer 2>&1 | tail -12
  git add api/src/ingestion/categorizer.service.ts api/src/ingestion/categorizer.service.spec.ts
  git commit -m "feat(ingestion): add merchant categorizer with rules and Mistral fallback"
  ```

---

## Task E6 — FX helper (USD → DOP)

**Files:**
- Create: `api/src/ingestion/fx.service.ts`

**Why:** `CurrencyService` lives in `repo/` only. `api/` needs its own minimal converter. Env rate is the floor so ingestion never blocks on a network call.

- [ ] **Step 1: Create `fx.service.ts`**

  ```typescript
  import { Injectable, Logger } from '@nestjs/common';

  const ONE_HOUR = 3_600_000;

  @Injectable()
  export class FxService {
    private readonly logger = new Logger(FxService.name);
    private cached: number | null = null;
    private cachedAt = 0;

    /** USD -> DOP. Falls back to USD_DOP_RATE env, then a conservative default. */
    async usdToDop(amount: number): Promise<number> {
      const rate = await this.getRate();
      return Math.round(amount * rate * 100) / 100;
    }

    private async getRate(): Promise<number> {
      if (this.cached && Date.now() - this.cachedAt < ONE_HOUR) return this.cached;
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const json = (await res.json()) as { rates?: Record<string, number> };
        const rate = json.rates?.DOP;
        if (rate && rate > 0) {
          this.cached = rate;
          this.cachedAt = Date.now();
          return rate;
        }
      } catch (err) {
        this.logger.warn(`FX fetch failed, using fallback rate: ${String(err)}`);
      }
      return parseFloat(process.env.USD_DOP_RATE || '') || 60;
    }
  }
  ```

- [ ] **Step 2: Build and commit**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5
  git add api/src/ingestion/fx.service.ts
  git commit -m "feat(ingestion): add USD->DOP FX helper with cache and env fallback"
  ```

---

## Task E7 — IMAP mail client

**Files:**
- Modify: `api/package.json` (add `imapflow`)
- Create: `api/src/ingestion/mail.client.ts`

- [ ] **Step 1: Install imapflow**

  ```bash
  cd api && pnpm add imapflow
  ```

- [ ] **Step 2: Create `mail.client.ts`**

  ```typescript
  import { Injectable, Logger } from '@nestjs/common';
  import { ImapFlow } from 'imapflow';

  export interface FetchedMail {
    messageId: string;   // Gmail/RFC message id — the dedupe key
    sender: string;      // lowercased
    subject: string;
    body: string;        // plain text
    receivedAt: Date;
  }

  @Injectable()
  export class MailClient {
    private readonly logger = new Logger(MailClient.name);

    /** Fetches mail newer than `since` from the configured mailbox. */
    async fetchSince(since: Date, senders: string[]): Promise<FetchedMail[]> {
      const user = process.env.GMAIL_USER;
      const pass = process.env.GMAIL_APP_PASSWORD;
      if (!user || !pass) {
        this.logger.warn('GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping fetch');
        return [];
      }

      const mailbox = process.env.INGEST_MAILBOX || 'INBOX';
      const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user, pass },
        logger: false,
      });

      const out: FetchedMail[] = [];
      await client.connect();
      try {
        const lock = await client.getMailboxLock(mailbox);
        try {
          for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
            const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? '';
            if (!senders.includes(from)) continue;

            const messageId = msg.envelope?.messageId ?? String(msg.uid);
            const body = this.extractPlainText(msg.source?.toString('utf8') ?? '');

            out.push({
              messageId,
              sender: from,
              subject: msg.envelope?.subject ?? '',
              body,
              receivedAt: msg.envelope?.date ?? new Date(),
            });
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
      return out;
    }

    /** Minimal MIME plain-text extraction; falls back to HTML stripped of tags. */
    private extractPlainText(raw: string): string {
      const plain = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n$)/i);
      if (plain?.[1]) return this.decode(plain[1]);
      return this.decode(raw).replace(/<[^>]+>/g, ' ');
    }

    private decode(s: string): string {
      return s
        .replace(/=\r?\n/g, '')                                   // quoted-printable soft breaks
        .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\r/g, '');
    }
  }
  ```

- [ ] **Step 3: Build and commit**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5
  git add api/package.json api/pnpm-lock.yaml api/src/ingestion/mail.client.ts
  git commit -m "feat(ingestion): add IMAP mail client"
  ```

---

## Task E8 — Ingestion orchestrator, module, cron

**Files:**
- Modify: `api/package.json` (add `@nestjs/schedule`)
- Create: `api/src/ingestion/ingestion.service.ts`
- Create: `api/src/ingestion/ingestion.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Install the scheduler**

  ```bash
  cd api && pnpm add @nestjs/schedule
  ```

- [ ] **Step 2: Create `ingestion.service.ts`**

  ```typescript
  import { Injectable, Logger } from '@nestjs/common';
  import { InjectModel } from '@nestjs/mongoose';
  import { Cron } from '@nestjs/schedule';
  import { Model } from 'mongoose';
  import { Transaction } from '../shared/schemas/transaction.schema';
  import { Balance } from '../shared/schemas/balance.schema';
  import { BalanceHistory } from '../shared/schemas/balance-history.schema';
  import { CustomCategory } from '../shared/schemas/custom-category.schema';
  import { TransactionType } from '../shared/schemas/transaction-type.enum';
  import { MailClient } from './mail.client';
  import { CategorizerService } from './categorizer.service';
  import { FxService } from './fx.service';
  import { BankParser, ParsedTransaction } from './parsers/types';
  import { popularParser } from './parsers/popular.parser';
  import { bhdParser } from './parsers/bhd.parser';
  import { santaCruzParser } from './parsers/santacruz.parser';
  import { banreservasParser } from './parsers/banreservas.parser';

  const BUILT_IN = ['food','transport','housing','health','entertainment','salary','savings','other'];

  @Injectable()
  export class IngestionService {
    private readonly logger = new Logger(IngestionService.name);
    private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);
    private readonly parsers: BankParser[] = [popularParser, bhdParser, santaCruzParser, banreservasParser];

    constructor(
      @InjectModel(Transaction.name) private readonly txModel: Model<Transaction>,
      @InjectModel(Balance.name) private readonly balanceModel: Model<Balance>,
      @InjectModel(BalanceHistory.name) private readonly historyModel: Model<BalanceHistory>,
      @InjectModel(CustomCategory.name) private readonly categoryModel: Model<CustomCategory>,
      private readonly mail: MailClient,
      private readonly categorizer: CategorizerService,
      private readonly fx: FxService,
    ) {}

    @Cron(process.env.INGEST_POLL_CRON || '*/10 * * * *')
    async poll(): Promise<void> {
      try {
        await this.run();
      } catch (err) {
        this.logger.error('Ingestion poll failed', err instanceof Error ? err.stack : String(err));
      }
    }

    async run(): Promise<{ created: number; skipped: number; failed: number }> {
      const since = this.watermark();
      const senders = this.parsers.flatMap((p) => p.senders);
      const mails = await this.mail.fetchSince(since, senders);

      let created = 0, skipped = 0, failed = 0;
      const ownIdentifiers = (process.env.OWN_ACCOUNT_IDENTIFIERS || '').split(',').filter(Boolean);

      for (const mail of mails) {
        const parser = this.parsers.find((p) => p.senders.includes(mail.sender));
        if (!parser) { skipped++; continue; }

        let parsed: ParsedTransaction | null = null;
        try {
          parsed = parser.parse({ subject: mail.subject, body: mail.body, ownIdentifiers });
        } catch (err) {
          this.logger.error(`Parser ${parser.bank} threw on ${mail.messageId}`, String(err));
        }

        if (!parsed) {
          // Never silently drop: an allow-listed sender we couldn't use is worth seeing.
          this.logger.warn(`Unusable mail from ${mail.sender} (${mail.messageId}) subject="${mail.subject}"`);
          failed++;
          continue;
        }

        const ok = await this.persist(parsed, mail.messageId);
        ok ? created++ : skipped++;
      }

      this.logger.log(`Ingestion run: created=${created} skipped=${skipped} failed=${failed}`);
      return { created, skipped, failed };
    }

    private watermark(): Date {
      const configured = process.env.INGEST_START_AT;
      const start = configured ? new Date(configured) : new Date(Date.now() - 24 * 3600_000);
      return isNaN(start.getTime()) ? new Date(Date.now() - 24 * 3600_000) : start;
    }

    private async persist(p: ParsedTransaction, messageId: string): Promise<boolean> {
      // Convert USD at ingest; keep the original for traceability.
      let amount = p.amount;
      let originalAmount: number | undefined;
      let originalCurrency: string | undefined;
      if (p.currency === 'USD') {
        originalAmount = p.amount;
        originalCurrency = 'USD';
        amount = await this.fx.usdToDop(p.amount);
      }

      const custom = await this.categoryModel.find({ userId: this.userId, active: true }).lean();
      const allowed = [...BUILT_IN, ...custom.map((c) => c.name)];

      const { category, needsReview } =
        p.direction === 'income'
          ? { category: 'other', needsReview: true }   // a wire could be salary, a gift, a refund — ask
          : await this.categorizer.categorize(p.counterparty, allowed);

      const signed = p.direction === 'expense' ? -Math.abs(amount) : Math.abs(amount);

      try {
        const doc = await this.txModel.create({
          userId: this.userId,
          userName: 'email',
          transactionName: p.counterparty.toLowerCase(),
          // MUST use the enum: its values are the legacy strings 'Доход'/'Расход'.
          // Writing 'income'/'expense' would make these rows invisible to every
          // existing query that filters on TransactionType.
          transactionType:
            p.direction === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
          amount: signed,
          timestamp: p.occurredAt,
          category,
          categoryNeedsReview: needsReview,
          sourceMessageId: messageId,
          source: 'email',
          merchant: p.counterparty,
          cardLast4: p.cardLast4,
          originalAmount,
          originalCurrency,
          isWithdrawal: p.isWithdrawal,
          externalRef: p.externalRef,
        });
        await this.applyBalance(p, amount, String(doc._id));
        return true;
      } catch (err: any) {
        if (err?.code === 11000) {
          // Unique index on sourceMessageId — already ingested. Expected, not an error.
          return false;
        }
        this.logger.error(`Failed to persist ${messageId}`, err instanceof Error ? err.stack : String(err));
        return false;
      }
    }

    private async applyBalance(p: ParsedTransaction, amount: number, txId: string): Promise<void> {
      const balance =
        (await this.balanceModel.findOne({ userId: this.userId })) ??
        (await this.balanceModel.create({ userId: this.userId, balance: 0 }));

      const previousBalance = balance.balance;
      balance.balance += p.direction === 'income' ? amount : -amount;
      balance.lastActivity = new Date();
      await balance.save();

      // Mirrors the bot: history failure must never break ingestion.
      try {
        await this.historyModel.create({
          userId: this.userId,
          previousBalance,
          newBalance: balance.balance,
          delta: balance.balance - previousBalance,
          reason: p.direction,
          transactionName: p.counterparty,
          transactionId: txId,
        });
      } catch (err) {
        this.logger.error('Failed to record balance history', String(err));
      }
    }
  }
  ```

- [ ] **Step 3: Create `ingestion.module.ts`**

  ```typescript
  import { Module } from '@nestjs/common';
  import { MongooseModule } from '@nestjs/mongoose';
  import { Transaction, TransactionSchema } from '../shared/schemas/transaction.schema';
  import { Balance, BalanceSchema } from '../shared/schemas/balance.schema';
  import { BalanceHistory, BalanceHistorySchema } from '../shared/schemas/balance-history.schema';
  import { CustomCategory, CustomCategorySchema } from '../shared/schemas/custom-category.schema';
  import { IngestionService } from './ingestion.service';
  import { MailClient } from './mail.client';
  import { CategorizerService } from './categorizer.service';
  import { FxService } from './fx.service';

  @Module({
    imports: [
      MongooseModule.forFeature([
        { name: Transaction.name, schema: TransactionSchema },
        { name: Balance.name, schema: BalanceSchema },
        { name: BalanceHistory.name, schema: BalanceHistorySchema },
        { name: CustomCategory.name, schema: CustomCategorySchema },
      ]),
    ],
    providers: [IngestionService, MailClient, CategorizerService, FxService],
  })
  export class IngestionModule {}
  ```

- [ ] **Step 4: Wire into `api/src/app.module.ts`**

  Add imports:
  ```typescript
  import { ScheduleModule } from '@nestjs/schedule';
  import { IngestionModule } from './ingestion/ingestion.module';
  ```
  Add `ScheduleModule.forRoot()` and `IngestionModule` to the `imports` array.

- [ ] **Step 5: Build and run the full suite**

  ```bash
  cd api && pnpm run build 2>&1 | tail -5 && npx jest 2>&1 | tail -10
  ```
  Expected: clean build, all parser/categorizer specs passing.

- [ ] **Step 6: Commit**

  ```bash
  git add api/package.json api/pnpm-lock.yaml api/src/ingestion/ api/src/app.module.ts
  git commit -m "feat(ingestion): add orchestrator, module wiring and poll cron"
  ```

---

## Task E9 — Web "Needs review" affordance

**Files:**
- Modify: `api/src/transactions/transactions.service.ts` + `transactions.controller.ts`
- Modify: `web/src/app/core/services/api.models.ts`, `api.service.ts`
- Modify: `web/src/app/pages/transactions/transactions.component.{ts,html,scss}`

- [ ] **Step 1: Expose the flag and a category-setter in the API**

  In `transactions.service.ts`, include `categoryNeedsReview`, `merchant` and `source` in the mapped response, and accept an optional `needsReview` filter in the list query (`{ categoryNeedsReview: true }` when set).

  Add a setter:
  ```typescript
  async setCategory(id: string, category: string): Promise<void> {
    await this.transactionModel.findOneAndUpdate(
      { _id: id, userId: this.userId },
      { category, categoryNeedsReview: false },
    );
  }
  ```

  In `transactions.controller.ts` add (keeping the existing `@UseGuards(JwtAuthGuard)`):
  ```typescript
  @Patch(':id/category')
  @HttpCode(204)
  async setCategory(@Param('id') id: string, @Body() body: { category: string }) {
    await this.transactionsService.setCategory(id, body.category);
  }
  ```
  Import `Patch`, `Param`, `Body`, `HttpCode` from `@nestjs/common`.

- [ ] **Step 2: Add the web API methods**

  In `api.models.ts`, add `categoryNeedsReview?: boolean; merchant?: string; source?: string;` to `Transaction`.

  In `api.service.ts`:
  ```typescript
    setTransactionCategory(id: string, category: string): Observable<void> {
      return this.http.patch<void>(`${this.base}/transactions/${id}/category`, { category });
    }
  ```
  And add an optional `needsReview?: boolean` to `getTransactions`'s opts, passed through as a param.

- [ ] **Step 3: Add the filter and inline setter to the transactions page**

  In `transactions.component.ts`: add `needsReviewOnly = false;`, include it in the load query, and add:
  ```typescript
    assignCategory(tx: Transaction, category: string) {
      this.api.setTransactionCategory(tx._id, category).subscribe({
        next: () => { tx.category = category; tx.categoryNeedsReview = false; },
        error: () => { alert('Failed to set category.'); },
      });
    }
    get reviewCategories(): string[] { return this.catSvc.all.map(c => c.name); }
  ```

  In `transactions.component.html`: add a "Needs review" toggle to the filters row, and in each row render a small `<select>` bound to `assignCategory(tx, $event.target.value)` when `tx.categoryNeedsReview` is true.

- [ ] **Step 4: Build both**

  ```bash
  cd api && pnpm run build 2>&1 | tail -3
  cd ../web && pnpm run build 2>&1 | tail -3
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add api/src/transactions/ web/src/app/
  git commit -m "feat(web): add needs-review filter and inline category assignment"
  ```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| IMAP + App Password | E7 |
| Auto-add, flag category only | E8 (`categoryNeedsReview`) + E9 (UI) |
| Forward-only | E8 (`watermark()`) |
| USD→DOP at ingest, original retained | E6 + E8 |
| BalanceHistory gap closed | E1 (schema) + E8 (`applyBalance`) |
| Banreservas direction-detected, null when unknown | E4 |
| Approval gate per bank | E2/E3 (status field), E4 (implicit) |
| Exact-sender matching | E2–E4 (`senders`) + E8 (allow-list) |
| Four date formats | E2 (`dates.ts`) |
| Never silently drop | E8 (`failed++` + warn log) |
| Dedupe via unique index | E1 (index) + E8 (11000 catch) |
| `isWithdrawal` seam for cash envelope | E2/E3 + E1 |

**Placeholder scan:** none — every step has complete code or an exact command.

**Type consistency:** `ParsedTransaction` defined in E2 is consumed unchanged in E3, E4, E8. `toAmount` defined in E2 is used by all four parsers. `BalanceChangeReason` values (`'income'`/`'expense'`) match what E8 writes. `CategoryResult` from E5 is destructured in E8.

**Caught during self-review — do not regress:** `TransactionType` is a legacy enum whose values are the Russian strings `INCOME = 'Доход'` and `EXPENSE = 'Расход'`, **not** `'income'`/`'expense'`. E8 therefore maps `direction` through the enum. Writing the literal English strings would create rows that every existing query filtering on `TransactionType` silently ignores — corrupting statistics, compare, analytics and the recurring processor without any error.

**Amount sign convention (verified):** expenses are stored **negative** (`api/src/shared/schemas/transaction.schema.ts` documents "Expenses are stored as negative numbers"), matching the bot's `createTransaction`. E8's `signed` calculation follows this.

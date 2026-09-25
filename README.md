# AccBot — Personal Accounting Bot

A personal finance tracker: a **web dashboard** for entry, review and reporting, fed by bank-email ingestion. The original **Telegram bot** is retired (scaled to zero, 2026-09).

---

## Overview

| Surface | Tech | Purpose |
|---|---|---|
| **Telegram bot** | NestJS + Telegraf + MongoDB | Retired (scaled to zero, 2026-09). Recurring bookings now run in the API |
| **Web dashboard** | Angular 17 | Review, filter, export, compare periods, view analytics |
| **REST API** | NestJS 10 + Mongoose | JWT-guarded backend for the web dashboard |

---

## Features

### Telegram Bot (`repo/`) — retired 2026-09

| Feature | Description |
|---|---|
| **Transactions** | Income and expense entry with categories, comma-separated multi-entry |
| **Budgets** | Per-category monthly limits with proactive alerts at ≥80% and over |
| **Recurring** | Moved to the API (2026-09): booked hourly, catching up missed days |
| **CSV Export** | Export all time / this month / last month as a CSV file |
| **Statistics** | Category pie chart and daily transaction chart for any month |
| **Balance History** | Full audit trail of every balance change |
| **AI Compare** | Anthropic Claude analysis of your spending vs. last period |
| **Currency** | Live exchange rates via open.er-api.com (1-hour cache) |
| **Languages** | English and Spanish |
| **Cron jobs** | Monthly summary report, daily budget check, inactivity reminder |

### Web Dashboard (`web/` + `api/`)

| Page | Description |
|---|---|
| **Dashboard** | Balance summary and recent activity |
| **Balance** | Set the balance to the total your accounts show (recorded as an adjustment, never as income or expense); a 90-day chart and the full history, filterable by kind |
| **Transactions** | Full transaction list with type, category, and date-range filters; one-click CSV export |
| **Budget** | Visual budget progress per category |
| **Statistics** | Monthly income/expense chart and category breakdown |
| **Compare** | Pick any two months and get a side-by-side summary + Mistral AI narrative |
| **Analytics** | Top-10 most frequent transactions table; click a row to see its monthly history chart |
| **Recurring** | Create rules; upcoming billing and what was billed this month. The API checks hourly and books each rule on its day (08:00 local), catching up days missed within 31 days |
| **Categories** | Create, edit, rename and delete your own categories; deleting one in use moves its transactions, recurring rules, budgets and cash items to a category you choose |
| **Cash envelopes** | Itemize an ATM withdrawal into what the cash was spent on; items count toward their categories' budgets and statistics without adding to total spending |
| **Settings** | See when bank mail was last read, check it now, dismiss mails that aren't transactions; turn the weekly and monthly emails on or off and choose where they go; edit the account numbers that tell your own transfers from spending |
| **Tips** | AI-generated personalised financial tips (Mistral, 1-hour cache) |
| **Email reports** | A weekly digest (Monday 07:00) and a monthly summary (the 1st), sent by the API through Gmail; "Send a test digest" on the Settings page sends one now |

---

## Repository Layout

```
Acc_bot/
├── repo/                   ← Telegram bot (NestJS + Telegraf)
│   ├── src/
│   │   ├── handler/        ← Telegraf @Update handlers (one per feature)
│   │   ├── service/        ← Business logic
│   │   ├── scene/          ← Wizard scenes (multi-step flows)
│   │   ├── mongodb/shemas/ ← Mongoose schemas
│   │   └── constants/      ← Message strings and button labels (EN/ES)
│   └── Dockerfile
├── api/                    ← REST API for the web dashboard (NestJS 10)
│   ├── src/
│   │   ├── auth/           ← JWT guard (Authentik JWKS)
│   │   ├── balance/        ← GET/PUT /api/balance, GET /api/balance/history, GET /api/balance/daily
│   │   ├── transactions/   ← GET /api/transactions, GET /api/transactions/export
│   │   ├── cash/           ← itemized withdrawals, per-category spending
│   │   ├── budget/         ← GET /api/budget
│   │   ├── statistics/     ← GET /api/statistics/*
│   │   ├── recurring/      ← GET /api/recurring
│   │   ├── tips/           ← GET /api/tips, POST /api/tips/refresh
│   │   ├── compare/        ← GET /api/compare/months, POST /api/compare
│   │   └── analytics/      ← GET /api/analytics/top10, GET /api/analytics/chart/:name
│   └── k8s/                ← Kubernetes manifests (Deployment, Service, ArgoCD app)
├── web/                    ← Angular 17 SPA
│   └── src/app/pages/      ← dashboard, transactions, budget, statistics,
│                               compare, analytics, recurring, tips
├── docker-compose.yml      ← Bot + MongoDB for local / Proxmox LXC deployment
├── DEPLOY.md               ← Proxmox LXC setup guide
└── setup-runner.sh         ← One-time GitHub Actions runner install
```

---

## Prerequisites

- **Node.js** 20+, **pnpm** 8+
- **Docker** and **Docker Compose** (for the bot)
- **MongoDB** 7 (provided by Docker Compose)
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather)
- A **Mistral API key** from [console.mistral.ai](https://console.mistral.ai) (free tier works)

---

## Quick Start — Telegram Bot

```bash
# 1. Clone
git clone https://github.com/DestinyM01/Accounting-Bot.git
cd Accounting-Bot

# 2. Create .env
cp .env.example .env
# Fill in TELEGRAM_TOKEN, MISTRAL_API_KEY, MONGO_URI

# 3. Start
docker compose up -d --build

# 4. Check logs
docker compose logs -f app
```

Expected healthy output:
```
[NestFactory] Starting Nest application...
[AppModule] Mongoose connected
[TelegrafModule] Bot started
```

### Environment Variables (bot)

| Variable | Description |
|---|---|
| `TELEGRAM_TOKEN` | Bot token from @BotFather |
| `MISTRAL_API_KEY` | Mistral API key for AI compare |
| `MONGO_URI` | MongoDB connection string (default: `mongodb://mongo:27017/accbot`) |
| `CRON_SCHEDULE` | Inactivity reminder cron expression (default: `47 15 * * *`) |
| `CRON_TIMEZONE` | Timezone for all cron jobs (default: `America/Santo_Domingo`) |
| `BOSS_USER_ID` | Your Telegram user ID — only this user can interact with the bot |

---

## Quick Start — Web Dashboard (local dev)

```bash
# API
cd api
pnpm install
pnpm run build   # compile TypeScript

# Web
cd web
pnpm install
pnpm start       # Angular dev server on http://localhost:4200
```

The web app expects the API at `/api` (proxied in `angular.json` or via nginx in production).

### Environment Variables (API)

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `BOSS_USER_ID` | Telegram user ID — all queries are scoped to this user |
| `MISTRAL_API_KEY` | Mistral API key for Tips and Compare |
| `AUTHENTIK_ISSUER` | OIDC issuer URL for JWT validation |
| `AUTHENTIK_JWKS_URI` | JWKS endpoint for JWT validation |
| `CORS_ORIGIN` | Allowed CORS origin for the web app |
| `PORT` | API port (default: `4000`) |
| `GMAIL_USER` | Gmail address to read from (default: none — ingestion disabled) |
| `GMAIL_APP_PASSWORD` | Google App Password, not the account password (default: none — ingestion disabled) |
| `INGEST_MAILBOX` | Mailbox/label to read (default: `INBOX`) |
| `INGEST_POLL_CRON` | Poll schedule, cron expression (default: `*/10 * * * *`, every 10 min) |
| `INGEST_START_AT` | Forward-only watermark, ISO date; mail older than this is never ingested (default: 24 hours ago) |
| `OWN_ACCOUNT_IDENTIFIERS` | Comma-separated own account last-4s and/or name fragment, used to decide transfer direction (default: empty — Banreservas transfers all skipped). A value saved on the Settings page takes precedence; this is only the starting value. |
| `OWN_CASH_ACCOUNTS` | Comma-separated last-4s of your own savings/checking accounts; transfers to these are internal, not expenses (default: empty — no transfer is treated as internal). A value saved on the Settings page takes precedence; this is only the starting value. |
| `REPORT_TO` | Recipient of the weekly digest and monthly summary (default: `GMAIL_USER`). Reports go through Gmail SMTP with the same app password. A value saved on the Settings page takes precedence; this is only the starting value. |
| `USD_DOP_RATE` | Fallback USD→DOP rate when the live FX lookup fails (default: `60`) |

**Email ingestion setup notes:**

1. `GMAIL_APP_PASSWORD` is a Google **App Password**, not your account password. Generate one under Google Account → Security → 2-Step Verification → App passwords (requires 2-Step Verification to be enabled).
2. **Recommended security posture:** create a Gmail filter that applies a label to mail from these four senders, then set `INGEST_MAILBOX` to that label (this account uses `Banks`) so the ingester reads only that label instead of the whole mailbox — this significantly reduces the blast radius of the credential:
   - `notificaciones@popularenlinea.com` (Banco Popular)
   - `alertas@bhd.com.do` (BHD)
   - `notificaciones@bsc.com.do` (Banco Santa Cruz)
   - `notificacionestubancoapp@banreservas.com` (Banreservas)
3. `INGEST_START_AT` should be set to roughly when you switch ingestion on — it's the forward-only guard that stops historical mail being ingested and double-counting against your current balance.
4. If `OWN_ACCOUNT_IDENTIFIERS` is unset, Banreservas transfers are skipped entirely — the direction can't be determined, and the system refuses to guess.

---

## Running Tests

```bash
cd api
pnpm test          # 22 unit tests across 3 suites
pnpm test:watch    # watch mode
```

Test coverage:
- `transactions.service.spec.ts` — 6 tests (exportCsv, buildFilter, CSV escaping)
- `compare.service.spec.ts` — 8 tests (getAvailableMonths, period summaries, Mistral)
- `analytics.service.spec.ts` — 8 tests (top-10 aggregation, monthly chart)

---

## Deployment

### Kubernetes (production)

The `api/k8s/` directory contains Kubernetes manifests managed by ArgoCD:

```bash
# Apply manually (or let ArgoCD sync)
kubectl apply -f api/k8s/
```

The deployment expects a secret named `accounting-bot-secret` with keys:
- `BOSID` → your Telegram user ID
- `MISTRAL_API_KEY` → Mistral API key

```bash
kubectl create secret generic accounting-bot-secret \
  --from-literal=BOSID=<your_telegram_id> \
  --from-literal=MISTRAL_API_KEY=<your_mistral_key> \
  -n accounting-bot
```

### Proxmox LXC (bot only)

See [DEPLOY.md](DEPLOY.md) for full step-by-step instructions.

---

## API Reference

All endpoints require a `Bearer` JWT token (issued by Authentik).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/balance` | Current balance summary |
| `PUT` | `/api/balance` | Set the balance to a total `{ balance, note? }`; recorded as a manual adjustment |
| `GET` | `/api/balance/history` | Balance history, newest first (`limit`, `offset`, `reason`) |
| `GET` | `/api/balance/daily` | Daily closing balances for the last `days` days (default 90) |
| `GET` | `/api/transactions` | Paginated transaction list (filters: `type`, `category`, `startDate`, `endDate`, `needsReview`, `unitemized`) |
| `GET` | `/api/transactions/export` | Download filtered transactions as CSV |
| `GET` | `/api/budget` | Budget progress by category for a given month |
| `GET` | `/api/statistics/summary` | Income / expense / net for a month |
| `GET` | `/api/statistics/monthly` | Monthly income+expense chart data |
| `GET` | `/api/statistics/by-category` | Expense breakdown by category |
| `GET` | `/api/recurring` | All recurring transaction entries |
| `POST` | `/api/reports/test` | Email the latest weekly digest now, marked [Test] |
| `GET` | `/api/categories` | Built-in and active custom categories |
| `GET` | `/api/categories/overview` | Every category with its usage, plus the palette and emoji for new ones |
| `POST` | `/api/categories` | Create a category `{ name, emoji, color }` |
| `PATCH` | `/api/categories/:id` | Change emoji or colour; a new name renames it everywhere |
| `DELETE` | `/api/categories/:id?moveTo=` | Delete, moving everything that uses it to `moveTo` |
| `POST` | `/api/categories/:id/finish` | Finish an interrupted move |
| `GET` | `/api/cash/withdrawals/:id` | A withdrawal's items, what's itemized and what's left |
| `POST` | `/api/cash/withdrawals/:id/allocations` | Itemize `{ category, amount, description? }` (never beyond the withdrawal) |
| `DELETE` | `/api/cash/allocations/:id` | Remove an item |
| `GET` | `/api/settings` | Report and account settings, each saved or from the server's config |
| `PUT` | `/api/settings/reports` | `{ weekly, monthly, recipient }` |
| `PUT` | `/api/settings/accounts` | `{ cash, senders }` |
| `GET` | `/api/ingestion/status` | Last run, last failure, unreadable mails and what mail booked lately |
| `POST` | `/api/ingestion/run` | Check bank mail now (409 while a check runs) |
| `POST` | `/api/ingestion/unreadable/:id/dismiss` | Stop retrying a mail that isn't a transaction |
| `GET` | `/api/tips` | AI financial tips (Mistral, 1h cache) |
| `POST` | `/api/tips/refresh` | Force-refresh tips |
| `GET` | `/api/compare/months` | Distinct months that have transaction data |
| `POST` | `/api/compare` | Compare two months with AI analysis `{ monthA, monthB }` |
| `GET` | `/api/analytics/top10` | Top 10 most frequent transactions (all time) |
| `GET` | `/api/analytics/chart/:name` | Monthly totals for a specific transaction name |
| `GET` | `/health` | Health check |

---

## Architecture

```
Telegram ──► Telegraf bot (repo/)
                 │
                 ▼
            MongoDB ◄──── NestJS API (api/)
                               │
                          JWT (Authentik)
                               │
                          Angular SPA (web/)
                               │
                          Browser
```

- The retired bot and the web API share the **same MongoDB database**; the API now writes everything (web entries, email ingestion, recurring bookings).
- Authentication for the web uses **Authentik OIDC** — the Angular app obtains a JWT via the OIDC flow and the API validates it against the Authentik JWKS endpoint.
- AI features use **Mistral `mistral-small-latest`** for both the Tips page and the Period Compare page.

---

## License

Private — personal use only.

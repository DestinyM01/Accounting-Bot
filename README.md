# AccBot — Personal Accounting Bot

A personal finance tracker with two surfaces: a **Telegram bot** for quick transaction entry and a **web dashboard** for analysis and reporting.

---

## Overview

| Surface | Tech | Purpose |
|---|---|---|
| **Telegram bot** | NestJS + Telegraf + MongoDB | Transaction entry, budgets, recurring items, CSV export, AI insights |
| **Web dashboard** | Angular 17 | Review, filter, export, compare periods, view analytics |
| **REST API** | NestJS 10 + Mongoose | JWT-guarded backend for the web dashboard |

---

## Features

### Telegram Bot (`repo/`)

| Feature | Description |
|---|---|
| **Transactions** | Income and expense entry with categories, comma-separated multi-entry |
| **Budgets** | Per-category monthly limits with proactive alerts at ≥80% and over |
| **Recurring** | Scheduled recurring transactions, processed daily at 08:00 |
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
| **Transactions** | Full transaction list with type, category, and date-range filters; one-click CSV export |
| **Budget** | Visual budget progress per category |
| **Statistics** | Monthly income/expense chart and category breakdown |
| **Compare** | Pick any two months and get a side-by-side summary + Mistral AI narrative |
| **Analytics** | Top-10 most frequent transactions table; click a row to see its monthly history chart |
| **Recurring** | Upcoming next billing and what was billed this month |
| **Tips** | AI-generated personalised financial tips (Mistral, 1-hour cache) |

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
│   │   ├── balance/        ← GET /api/balance
│   │   ├── transactions/   ← GET /api/transactions, GET /api/transactions/export
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
| `GET` | `/api/transactions` | Paginated transaction list (filters: `type`, `category`, `startDate`, `endDate`) |
| `GET` | `/api/transactions/export` | Download filtered transactions as CSV |
| `GET` | `/api/budget` | Budget progress by category for a given month |
| `GET` | `/api/statistics/summary` | Income / expense / net for a month |
| `GET` | `/api/statistics/monthly` | Monthly income+expense chart data |
| `GET` | `/api/statistics/by-category` | Expense breakdown by category |
| `GET` | `/api/recurring` | All recurring transaction entries |
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

- The bot and the web API share the **same MongoDB database** — the API reads what the bot writes.
- Authentication for the web uses **Authentik OIDC** — the Angular app obtains a JWT via the OIDC flow and the API validates it against the Authentik JWKS endpoint.
- AI features use **Mistral `mistral-small-latest`** for both the Tips page and the Period Compare page.

---

## License

Private — personal use only.

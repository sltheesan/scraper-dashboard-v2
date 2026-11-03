# Scraper Dashboard v2

A financial operations platform built on **NestJS + Next.js + PostgreSQL (Prisma)**. Starts as a multi-profile browser scraper dashboard and expands into reporting, analytics, and financial tracking.

> **v1** (current production at `https://scraper.200m.tech`) is a Fastify + vanilla JS + MongoDB app. It continues running untouched until v2 is ready to replace it.

---

## Stack

| Layer | Choice |
|---|---|
| Backend | NestJS 11 (TypeScript, modular) |
| Frontend | Next.js 15 (App Router, React 19) |
| Database | PostgreSQL (DigitalOcean Managed) |
| ORM | Prisma 6 |
| Auth | JWT (Bearer token), bcrypt, Passport |
| Monorepo | Turborepo + npm workspaces |
| Browser automation | Playwright (real Chrome channel) |
| Telegram | Bot API via long polling |

---

## Project Structure

```
scraper-dashboard-v2/
├── apps/
│   ├── api/                    # NestJS backend (port 4000)
│   │   └── src/
│   │       ├── main.ts         # Entry, Swagger, validation pipes
│   │       ├── app.module.ts   # Root module
│   │       ├── prisma/         # Global PrismaService
│   │       ├── auth/           # JWT login/register, guards, RBAC
│   │       └── profiles/       # Profile CRUD (role-gated)
│   └── web/                    # Next.js frontend (port 3001)
│       └── src/app/            # App router, globals
├── packages/
│   └── database/               # Prisma schema + generated client
│       └── prisma/schema.prisma
├── turbo.json
├── package.json
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- PostgreSQL (local or DigitalOcean Managed Database)
- Google Chrome (for Playwright scraping, later phases)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/sltheesan/scraper-dashboard-v2.git
cd scraper-dashboard-v2
npm install

# 2. Create .env in the root (copy from .env.example)
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# 3. Push schema to database
npm run db:push

# 4. Start both apps
npm run dev
# API:  http://localhost:4000  (Swagger: http://localhost:4000/api/docs)
# Web:  http://localhost:3001

# 5. Create first admin user
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@200m.co","password":"your-password","name":"Admin"}'
```

### Useful commands

```bash
npm run dev          # Start API + Web in parallel
npm run build        # Build all apps
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:push      # Push schema to DB (dev, no migrations)
npm run db:migrate   # Create and apply a migration (production)
npm run db:studio    # Open Prisma Studio (DB browser)
```

---

## Database Schema

### Models

| Model | Purpose |
|---|---|
| **User** | Auth accounts with roles (ADMIN, OPERATOR, VIEWER) |
| **Profile** | A scraper target — one Chrome session per profile (cgaming or zoomwlb) |
| **ProfileCredential** | Encrypted username/password/PIN for each profile (1:1 with Profile) |
| **Scrape** | Scraped metrics per profile per day, unique on (profileId, reportDate) |
| **Setting** | Key-value settings (scheduler config, telegram config, etc.) |
| **ActivityLog** | Audit trail — who did what, when |

### Scrape Metrics (per profile, per day)

- `newRegistrationCount`
- `newDepositCount`
- `totalDepositCount`
- `totalDepositAmount` (Decimal)
- `totalWithdrawalCount`
- `totalWithdrawalAmount` (Decimal)

---

## Auth & RBAC

| Role | Permissions |
|---|---|
| **ADMIN** | Full access — manage users, profiles, credentials, settings, delete anything |
| **OPERATOR** | Manage profiles, trigger scrapes, view credentials, view reports |
| **VIEWER** | Read-only — view profiles, scrape data, reports |

JWT Bearer token auth. Login returns a token; include as `Authorization: Bearer <token>`.

---

## Production Infrastructure (v1, continues running)

| Item | Value |
|---|---|
| Domain | `https://scraper.200m.tech` |
| noVNC | `https://scraper.200m.tech/vnc/vnc.html` |
| VPS | DigitalOcean SGP1, 8 vCPU, 16 GB RAM |
| VPS IP | `159.89.201.35` |
| SSH | `ssh root@159.89.201.35` |
| Reverse proxy | Caddy (ports 80/443) → app (3000) + noVNC (6080) |
| Database (v1) | MongoDB native on host |
| Database (v2) | PostgreSQL on DigitalOcean Managed Database |

---

## Roadmap

### Phase 1: Foundation ✅ (scaffolded)

- [x] Monorepo setup (Turborepo + npm workspaces)
- [x] NestJS backend with modular architecture
- [x] Next.js frontend with App Router
- [x] PostgreSQL + Prisma schema
- [x] JWT auth with login/register
- [x] RBAC (ADMIN / OPERATOR / VIEWER roles + guards)
- [x] Profile CRUD module (role-gated)
- [ ] Connect to DO Managed Database
- [ ] First admin user setup
- [ ] Login page (Next.js)
- [ ] Dashboard layout (sidebar nav, header, profile list)
- [ ] Profile management UI (list, create, edit, delete)
- [ ] User management UI (admin only)
- [ ] Settings page (scheduler, telegram)

### Phase 2: Scraper Migration

Bring the Playwright scraping engine from v1 into v2 as a NestJS module.

- [ ] Scraper module — context pool, openContext, runFetch, runRefresh
- [ ] Parser module — cgaming parser, zoomwlb parser, common schema
- [ ] Scheduler service — periodic fetch + refresh (NestJS `@nestjs/schedule`)
- [ ] Daily capture service — archive yesterday's numbers at cutover + 15 min
- [ ] Scrape data API — today, yesterday, date range queries
- [ ] Live log stream (SSE or WebSocket)
- [ ] noVNC proxy route
- [ ] Manual login flow via VNC
- [ ] Migrate historical scrape data from MongoDB → Postgres
- [ ] Telegram bot module
- [ ] Session-expired alerts

### Phase 3: Credential Management + OTP

Move what System 200M currently handles (profile credentials + Gmail OTP) into this platform.

- [ ] ProfileCredential encrypted storage (AES-256, keyed by ENCRYPTION_KEY)
- [ ] Credential UI — view/edit username, password, PIN per profile
- [ ] Auto-fill login — use stored credentials in the manual login flow
- [ ] Gmail OTP reader — connect to Gmail via OAuth, extract OTP from emails
- [ ] "Get OTP" button per profile in the dashboard
- [ ] OTP auto-fill during login flow

### Phase 4: Multi-User Access Control

Open the system to team members with restrictions.

- [ ] User invitation / registration flow (admin invites by email)
- [ ] Per-profile visibility — assign profiles to users/roles
- [ ] Operator view — can only see assigned profiles
- [ ] Viewer view — read-only, no credentials, no settings
- [ ] Activity audit trail (all actions logged with actor)
- [ ] Session management — force logout, active sessions list

### Phase 5: Reports, Charts & Analytics

Build the intelligence layer on top of scraped data.

- [ ] Aggregation API — daily/weekly/monthly summaries, cross-profile totals
- [ ] Dashboard charts — deposits, withdrawals, registrations over time
- [ ] Per-profile trend cards
- [ ] Comparison view — side-by-side profiles or profile groups
- [ ] Scheduled reports — daily/weekly summaries via email or Telegram
- [ ] Export — CSV, PDF
- [ ] Custom date range queries with filters

### Phase 6: Financial Expansion

Extend beyond scraping into a broader financial operations platform.

- [ ] Manual data entry — record transactions, adjustments
- [ ] P&L tracking per profile/brand
- [ ] Reconciliation tools
- [ ] Custom dashboards and KPI tracking
- [ ] Additional data source integrations

---

## Environment Variables

```bash
# PostgreSQL (DigitalOcean Managed Database)
DATABASE_URL=postgresql://user:password@host:25060/scraper?sslmode=require

# Auth
JWT_SECRET=<random-64-char-hex>
JWT_EXPIRATION=7d

# Encryption for stored credentials
ENCRYPTION_KEY=<random-32-byte-hex>

# Telegram bot
TELEGRAM_BOT_TOKEN=

# Gmail OTP reader (Phase 3)
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=

# App
NODE_ENV=development
PORT=4000
HEADLESS=true
BROWSER_CHANNEL=chrome
TZ=Asia/Bangkok
```

---

## Conventions

- **Timezone:** All date/time logic uses `Asia/Bangkok` (GMT+7). Set `TZ=Asia/Bangkok` at process level.
- **Backend modules:** Each feature is a NestJS module under `apps/api/src/<name>/` with `*.module.ts`, `*.controller.ts`, `*.service.ts`, and DTOs.
- **Frontend features:** Each feature under `apps/web/src/app/(dashboard)/<name>/` using Next.js App Router conventions.
- **Database changes:** Edit `packages/database/prisma/schema.prisma`, then `npm run db:generate` + `npm run db:push` (dev) or `npm run db:migrate` (prod).
- **Credentials:** Always encrypted at rest. Never log decrypted values. Use `ENCRYPTION_KEY` env var.
- **Scrapes:** Upsert by `(profileId, reportDate)` — idempotent, re-running a day overwrites.
- **Plan first:** For non-trivial work, explain the approach and confirm before coding.

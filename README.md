# Scraper Dashboard v2

A financial operations platform built on **NestJS + Next.js + PostgreSQL (Prisma)**. Multi-profile browser scraper dashboard with encrypted credentials, Gmail OTP reader, Telegram bot, and scheduled data capture.

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
| Security | Helmet, rate limiting, SSRF protection |

---

## Project Structure

```
scraper-dashboard-v2/
├── apps/
│   ├── api/                    # NestJS backend (port 4000)
│   │   └── src/
│   │       ├── main.ts         # Entry, Swagger, Helmet, validation pipes
│   │       ├── app.module.ts   # Root module (ThrottlerModule, etc.)
│   │       ├── prisma/         # Global PrismaService
│   │       ├── auth/           # JWT login/register/logout, guards, RBAC
│   │       ├── profiles/       # Profile CRUD, login flow, fetch
│   │       ├── credentials/    # Encrypted credentials, Gmail OTP reader
│   │       ├── scraper/        # Playwright browser pool, parsers
│   │       ├── scrapes/        # Scrape data CRUD, runAndSave, fetchYesterday
│   │       ├── scheduler/      # Cron-based fetch + refresh schedules
│   │       ├── daily-capture/  # 00:15 ICT daily capture for all profiles
│   │       ├── telegram/       # Bot, inline keyboards, PNG cards, alerts
│   │       ├── settings/       # Key-value settings (scheduler, telegram, platform)
│   │       ├── activity/       # Audit trail with search/filter
│   │       ├── logs/           # In-memory ring buffer + SSE stream
│   │       ├── backup/         # EJSON backup import/restore from v1
│   │       ├── users/          # User management
│   │       └── common/         # Shared utilities (URL validator, business-day)
│   └── web/                    # Next.js frontend (port 3001)
│       └── src/app/
│           ├── login/          # Login page
│           ├── globals.css     # Dark/light theme CSS variables
│           └── (dashboard)/    # Auth-protected dashboard routes
│               ├── layout.tsx  # Sidebar, top bar, clock, theme toggle
│               ├── profiles/   # Profile management + fetch result popups
│               ├── settings/   # Scheduler, Telegram, platform settings
│               ├── activity/   # Audit log viewer
│               ├── logs/       # Real-time SSE log viewer
│               └── users/      # User management
├── packages/
│   └── database/               # Prisma schema + generated client
│       └── prisma/schema.prisma
├── turbo.json
├── package.json
└── .env
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- PostgreSQL (local or DigitalOcean Managed Database)
- Google Chrome (for Playwright browser automation)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/sltheesan/scraper-dashboard-v2.git
cd scraper-dashboard-v2
npm install

# 2. Create .env in the root
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY

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
| **ProfileCredential** | Encrypted username/password/PIN + OTP email for each profile (1:1) |
| **Scrape** | Scraped metrics per profile per day, unique on (profileId, reportDate) |
| **Setting** | Key-value settings (scheduler config, telegram config, platform config) |
| **ActivityLog** | Audit trail — who did what, when (USER, TELEGRAM, SYSTEM, ADMIN actors) |
| **BackupImport** | Import audit trail with SHA-256 dedup for v1 backup restore |
| **LegacyDocument** | Preserved original v1 MongoDB documents |

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

## Security

| Measure | Implementation |
|---|---|
| **Rate limiting** | `@nestjs/throttler` — login (5/min), register (3/min) per IP |
| **SSRF prevention** | URL validator blocks private IPs, link-local, cloud metadata, localhost |
| **Security headers** | Helmet (X-Frame-Options, X-Content-Type-Options, HSTS, etc.) |
| **Next.js headers** | X-Frame-Options DENY, nosniff, HSTS, Referrer-Policy, Permissions-Policy |
| **CORS** | Allowlist via `CORS_ORIGIN` env var (defaults to localhost:3000) |
| **Credentials** | AES-256-CBC encryption at rest, keyed by `ENCRYPTION_KEY` |
| **Cache-Control** | `no-store` on login page |
| **Telegram** | Restricted mode (default), allowedChatIds + allowedUsernames |
| **Auth** | JWT with bcrypt password hashing, logout endpoint guarded |

---

## API Endpoints

### Auth
- `POST /api/auth/login` — rate-limited, returns `{ accessToken, user }`
- `POST /api/auth/register` — rate-limited, creates user
- `GET /api/auth/me` — current user info (JWT required)
- `POST /api/auth/logout` — authenticated logout

### Profiles
- `GET|POST /api/profiles` — list/create (SSRF validated)
- `GET|PATCH|DELETE /api/profiles/:id` — read/update/delete
- `POST /api/profiles/:id/login` — open browser login window
- `POST /api/profiles/:id/login/finish` — save session cookies
- `POST /api/profiles/:id/login/cancel` — close login window
- `POST /api/profiles/:id/fetch` — fetch today/yesterday scrape data

### Credentials
- `GET|PUT|DELETE /api/profiles/:id/credentials` — encrypted credential CRUD
- `POST /api/profiles/:id/credentials/otp` — fetch OTP from Gmail

### Settings
- `GET|PATCH /api/settings/scheduler` — scheduler config
- `GET|PATCH /api/settings/telegram` — telegram config + bot token
- `GET|PATCH /api/settings/platform` — platform settings

### Activity & Logs
- `GET /api/activity` — paginated audit log (filter by actorType, action, search)
- `GET /api/activity/actions` — distinct action values
- `GET /api/logs/stream` — SSE event stream

### Backup
- `GET /api/backup` — EJSON backup download
- `POST /api/backup/restore` — restore from v1 backup

---

## Frontend Pages

| Route | Description |
|---|---|
| `/login` | Login form (Cache-Control: no-store) |
| `/` | Dashboard home |
| `/profiles` | Profile list with login/fetch/edit, Telegram-style fetch result popup |
| `/profiles/[id]` | Profile detail |
| `/settings` | Scheduler, Telegram, platform settings |
| `/activity` | Audit log with search, action filter, sticky header |
| `/logs` | Real-time SSE log viewer |
| `/users` | User management |

### Theme
- Dark mode (default): `--bg: #0f1115`, `--surface: #181b22`, `--accent: #4f8cff`
- Light mode: `--bg: #f4f5f7`, `--surface: #ffffff`, `--accent: #3b72e9`
- Toggle via header button, persisted in localStorage

---

## Production Infrastructure

| Item | Value |
|---|---|
| v1 Domain | `https://scraper.200m.tech` |
| VPS | DigitalOcean SGP1, 8 vCPU, 16 GB RAM |
| VPS IP | `159.89.201.35` |
| Reverse proxy | Caddy (ports 80/443) |
| Database (v1) | MongoDB native on host |
| Database (v2) | PostgreSQL on DigitalOcean Managed Database |

---

## Roadmap

### Phase 1: Foundation ✅

- [x] Monorepo setup (Turborepo + npm workspaces)
- [x] NestJS backend with modular architecture
- [x] Next.js frontend with App Router
- [x] PostgreSQL + Prisma schema
- [x] JWT auth with login/register/logout
- [x] RBAC (ADMIN / OPERATOR / VIEWER roles + guards)
- [x] Profile CRUD module (role-gated)
- [x] Login page
- [x] Dashboard layout (sidebar nav, top bar, live clock, theme toggle)
- [x] Profile management UI (list, create, edit, delete)
- [x] User management UI (admin only)
- [x] Settings page (scheduler, telegram, platform)

### Phase 2: Scraper Migration ✅

- [x] Scraper module — context pool, openContext, runFetch, runRefresh
- [x] Parser module — cgaming parser, zoomwlb parser, common schema
- [x] Scheduler service — periodic fetch + refresh (`@nestjs/schedule`)
- [x] Daily capture service — archive yesterday at 00:15 ICT, startup catch-up
- [x] Scrape data API — today, yesterday
- [x] Live log stream (SSE)
- [x] Manual login flow via persistent browser context
- [x] Migrate historical scrape data from MongoDB → Postgres (backup/restore)
- [x] Telegram bot module (long-polling, inline keyboards, PNG cards)
- [x] Session-expired and access-denied alerts
- [x] Activity logging for all operations

### Phase 3: Credential Management + OTP ✅

- [x] ProfileCredential encrypted storage (AES-256-CBC)
- [x] Credential UI — view/edit username, password, PIN per profile
- [x] Login session modal — credentials with copy buttons
- [x] Gmail OTP reader — OAuth2 refresh token, handles forwarded emails
- [x] "Get OTP" button per profile in the dashboard
- [x] Credentials section in profile edit modal

### Phase 4: Security Hardening ✅

- [x] Rate limiting on login/register endpoints (ThrottlerGuard)
- [x] SSRF prevention — URL validation blocks private IPs, metadata endpoints
- [x] Security headers — Helmet + Next.js security headers
- [x] CORS allowlist (no longer accepts all origins)
- [x] Cache-Control on login page
- [x] Authenticated logout endpoint
- [x] Telegram restricted mode by default

### Phase 5: Reports, Charts & Analytics (Planned)

- [ ] Aggregation API — daily/weekly/monthly summaries, cross-profile totals
- [ ] Dashboard charts — deposits, withdrawals, registrations over time
- [ ] Per-profile trend cards
- [ ] Comparison view — side-by-side profiles or profile groups
- [ ] Scheduled reports — daily/weekly summaries via email or Telegram
- [ ] Export — CSV, PDF
- [ ] Custom date range queries with filters

### Phase 6: Financial Expansion (Planned)

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

# Gmail OTP reader
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=

# CORS (comma-separated origins, defaults to http://localhost:3000)
CORS_ORIGIN=http://localhost:3000

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
- **Numbers:** Display with comma formatting (`toLocaleString('en-US')`), parse strings with `parseFloat()` first.
- **Security:** All profile URLs validated against SSRF. Login rate-limited. Helmet enabled. CORS allowlisted.

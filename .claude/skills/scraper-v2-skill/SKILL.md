---
name: scraper-v2-skill
description: >-
  Reference for the Scraper Dashboard v2 project (NestJS + Next.js + PostgreSQL +
  Prisma monorepo). Use when working in this codebase to recall architecture,
  modules, database schema, auth/RBAC, security, frontend pages, and conventions.
  Load before adding features, debugging, or running the server.
---

# Scraper Dashboard v2 — Project Skill

A financial operations platform: NestJS 11 backend, Next.js 15 frontend,
PostgreSQL via Prisma 6, Turborepo monorepo. Replaces v1 (Fastify + vanilla JS
+ MongoDB at `https://scraper.200m.tech`).

Project root: `C:\Users\User\Documents\Projects\scraper-dashboard-v2`

---

## 1. Monorepo Layout

```
scraper-dashboard-v2/
├── apps/
│   ├── api/          # NestJS backend (port 4000)
│   └── web/          # Next.js frontend (port 3001, proxies /api → 4000)
├── packages/
│   └── database/     # Prisma schema + generated client (@scraper/database)
├── turbo.json        # Task pipeline
├── package.json      # Workspace root
└── .env              # Shared env (DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, etc.)
```

**Workspaces:** `@scraper/api`, `@scraper/web`, `@scraper/database`.

**Key commands:**
- `npm run dev` → starts both apps via Turborepo
- `npm run db:push` → push Prisma schema to DB (dev)
- `npm run db:migrate` → create migration (prod)
- `npm run db:generate` → regenerate Prisma client
- `npm run db:studio` → Prisma Studio browser

---

## 2. Backend (NestJS) — `apps/api/`

Entry: `src/main.ts` → sets `TZ=Asia/Bangkok`, global prefix `/api`, Swagger at `/api/docs`.

### Modules

| Module | Path | Purpose |
|---|---|---|
| **PrismaModule** | `src/prisma/` | Global `PrismaService` (connects on init, disconnects on destroy) |
| **AuthModule** | `src/auth/` | JWT login/register/logout, `JwtStrategy`, `JwtAuthGuard`, `RolesGuard` |
| **ProfilesModule** | `src/profiles/` | Profile CRUD, login flow, fetch/yesterday endpoints, SSRF validation |
| **CredentialsModule** | `src/credentials/` | AES-encrypted credentials (username/password/PIN/TOTP), Gmail OTP reader, TOTP generation |
| **VncModule** | `src/vnc/` | VNC session management: single-user lock, token auth, force end-session |
| **HealthController** | `src/health.controller.ts` | Health check endpoint at `/api/health` (DB latency, uptime) |
| **ScraperModule** | `src/scraper/` | Playwright browser pool, context management, page parsing |
| **ScrapesModule** | `src/scrapes/` | Scrape CRUD, `runAndSave`, `fetchYesterday` (DB-first, browser fallback) |
| **SchedulerModule** | `src/scheduler/` | Cron-based fetch + refresh schedules, per-profile running locks |
| **DailyCaptureModule** | `src/daily-capture/` | 00:15 ICT daily capture for all profiles, startup catch-up |
| **TelegramModule** | `src/telegram/` | Long-polling bot, inline keyboards, PNG card rendering, session alerts |
| **SettingsModule** | `src/settings/` | Key-value settings (scheduler, telegram, platform config) |
| **ActivityModule** | `src/activity/` | Paginated audit trail, search, filter by action/actorType |
| **LogsModule** | `src/logs/` | In-memory ring buffer + SSE stream at `/api/logs/stream` |
| **BackupModule** | `src/backup/` | EJSON backup import/restore from v1 MongoDB |
| **UsersModule** | `src/users/` | User management (list, update role, deactivate) |

### API Endpoints

**Auth:**
- `POST /api/auth/login` — rate-limited (5/min), returns `{ accessToken, user }`
- `POST /api/auth/register` — rate-limited (3/min), creates user
- `GET /api/auth/me` — current user info (requires JWT)
- `POST /api/auth/logout` — authenticated logout

**Profiles:**
- `GET|POST /api/profiles` — list/create (URL fields validated against SSRF)
- `GET|PATCH|DELETE /api/profiles/:id` — read/update/delete
- `POST /api/profiles/:id/login` — open browser login window
- `POST /api/profiles/:id/login/finish` — save session cookies
- `POST /api/profiles/:id/login/cancel` — close login window
- `POST /api/profiles/:id/fetch` — fetch today/yesterday data, returns `conversions` (USD/IDR labels) and `fetchedAt`

**Credentials:**
- `GET|PUT|DELETE /api/profiles/:id/credentials` — encrypted credential CRUD (username, password, PIN, TOTP secret, OTP email)
- `POST /api/profiles/:id/credentials/otp` — fetch OTP from Gmail
- `POST /api/profiles/:id/credentials/totp` — generate current TOTP code from stored secret

**VNC:**
- `POST /api/vnc/token` — create VNC session token (single-user lock, blocks if another user is active)
- `GET /api/vnc/session` — returns active VNC session status (userName, profileName, isOwner)
- `POST /api/vnc/end-session` — force-ends active VNC session (any user can call)
- `GET /api/vnc/auth` — validates token from `X-Forwarded-Uri` header

**Health:**
- `GET /api/health` — returns `{ status, uptime, dbLatencyMs, timestamp }`

**Settings:**
- `GET|PATCH /api/settings/scheduler` — scheduler config
- `GET|PATCH /api/settings/telegram` — telegram config + bot token update
- `GET|PATCH /api/settings/platform` — platform-wide settings

**Activity:**
- `GET /api/activity` — paginated, filterable by actorType, action, search
- `GET /api/activity/actions` — distinct action values for filter dropdown

**Other:**
- `GET /api/logs/stream` — SSE event stream
- `GET /api/backup` — EJSON backup download
- `POST /api/backup/restore` — restore from v1 backup

### Auth & RBAC

- JWT Bearer token via `@nestjs/passport` + `passport-jwt`.
- Privilege-based via user groups, `hasPrivilege()` function, `isSuperAdmin` boolean.
- Guards: `JwtAuthGuard` (authenticated?), `PrivilegesGuard` + `@Privileges(...)` (has privilege?). SuperAdmin bypasses all privilege checks.
- JWT payload: `sub` (user id), `email`, `isSuperAdmin`, `privileges[]` — does NOT contain `name`.

### Security

- **Rate limiting:** `@nestjs/throttler` on login (5/min) and register (3/min).
- **SSRF prevention:** `src/common/url-validator.ts` blocks private IPs (10.x, 172.16-31.x, 192.168.x, 127.x), link-local (169.254.x), metadata endpoints, localhost. Applied to `loginUrl`, `targetUrl`, `proxy` on profile create/update.
- **Security headers:** `helmet` middleware (X-Frame-Options, X-Content-Type-Options, HSTS, etc.). CSP relaxed for dashboard frontend.
- **CORS:** Allowlist via `CORS_ORIGIN` env var (defaults to `http://localhost:3000`).
- **Credentials encryption:** AES-256-CBC keyed by `ENCRYPTION_KEY` env var. ENCRYPTION_KEY must be a 64-char hex string; otherwise falls back to `Buffer.alloc(32, key)`.
- **Swagger:** Disabled when `NODE_ENV=production`.
- **Body parser limits:** 2MB global, 100MB on `/api/backup`.
- **VNC session lock:** Single-user access with token TTL (5 min), any user can force-end.

---

## 3. Frontend (Next.js) — `apps/web/`

- App Router (`src/app/`), React 19, TypeScript.
- API calls proxy via `next.config.ts` rewrites (`/api/*` → `localhost:4000`).
- Port 3001 in dev.

### Pages

| Route | File | Description |
|---|---|---|
| `/login` | `src/app/login/page.tsx` | Login form, Cache-Control: no-store |
| `/` | `src/app/(dashboard)/page.tsx` | Dashboard home |
| `/profiles` | `src/app/(dashboard)/profiles/page.tsx` | Profile list, login/fetch/edit, fetch result popup (Telegram card style) |
| `/profiles/[id]` | `src/app/(dashboard)/profiles/[id]/page.tsx` | Profile detail |
| `/settings` | `src/app/(dashboard)/settings/page.tsx` | Scheduler, Telegram, platform settings |
| `/activity` | `src/app/(dashboard)/activity/page.tsx` | Audit log with search, filter, sticky header |
| `/logs` | `src/app/(dashboard)/logs/page.tsx` | Real-time SSE log viewer |
| `/users` | `src/app/(dashboard)/users/page.tsx` | User management |

### Dashboard Layout

- `src/app/(dashboard)/layout.tsx` — sidebar + top bar with:
  - Live clock (Asia/Bangkok ICT)
  - v2 environment badge
  - Dark/light theme toggle (CSS variables, `data-theme` attribute, localStorage)
  - User name, role, sign-out button
- `src/app/globals.css` — CSS custom properties for dark/light theming:
  - Dark (default): `--bg: #0f1115`, `--surface: #181b22`, `--accent: #4f8cff`
  - Light: `--bg: #f4f5f7`, `--surface: #ffffff`, `--accent: #3b72e9`

### Security Headers (Next.js)

- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()
- Strict-Transport-Security (HSTS)
- `poweredByHeader: false`

---

## 4. Database (Prisma) — `packages/database/`

Schema: `prisma/schema.prisma`. Client exported from `src/index.ts` as `@scraper/database`.

### Models

| Model | Table | Key fields |
|---|---|---|
| **User** | `users` | `email`(unique), `name`, `passwordHash`, `role`(ADMIN\|OPERATOR\|VIEWER), `isActive` |
| **Profile** | `profiles` | `name`(unique), `kind`(CGAMING\|ZOOMWLB\|ONEOPSPORTAL), `loginUrl`, `targetUrl`, `status`, `proxy`, `buttonSelector`, `dataFields` |
| **ProfileCredential** | `profile_credentials` | 1:1 with Profile. `usernameEncrypted`, `passwordEncrypted`, `pinEncrypted`, `totpSecretEncrypted`, `otpEmail` |
| **Scrape** | `scrapes` | `profileId`+`reportDate`(unique). 6 metrics: registration/deposit/withdrawal counts+amounts. `raw`/`data`/`tables` JSON. |
| **Setting** | `settings` | `key`(unique), `value`(JSON). Keys: `scheduler`, `telegram`, `platform` |
| **ActivityLog** | `activity_logs` | `actorType`(ADMIN\|USER\|TELEGRAM\|SYSTEM), `actorId`, `action`, `target`, `details`, `meta` |
| **BackupImport** | `backup_imports` | Import audit trail with SHA-256 dedup |
| **LegacyDocument** | `legacy_documents` | Original v1 MongoDB documents preserved |

### Conventions

- All IDs are `cuid()`.
- Amount fields use `Decimal(18,2)`.
- Credentials are AES-256-CBC encrypted, keyed by `ENCRYPTION_KEY` env var.
- Scrapes are unique on `(profileId, reportDate)` — upsert, not insert.
- After schema changes: `npm run db:generate` then `npm run db:push` (dev) or `npm run db:migrate` (prod).

---

## 5. Scraper Engine

### Browser Pool (`src/scraper/scraper.service.ts`)
- Playwright persistent contexts with real Chrome channel
- One `BrowserContext` per profile, auto-closes idle > 30 min
- Cookie persistence to `profiles/<name>/session-cookies.json`
- Anti-detection: custom UA, `webdriver` spoofing, automation flags disabled

### Parsers (`src/scraper/parsers/`)
- **cgaming.parser.ts** — table-based parsing, date-matching rows
- **zoomwlb.parser.ts** — element ID-based, amounts ×1000
- **common.ts** — shared 6-metric schema, `reportDateFor()`, `FetchResult` type

### Scrapes Service (`src/scrapes/scrapes.service.ts`)
- `runAndSave()` — fetch + parse + upsert to DB
- `fetchYesterday()` — DB-first, browser fallback
- Integrates with ScraperService for browser operations

---

## 6. Credentials & OTP

### Encrypted Storage (`src/credentials/credentials.service.ts`)
- AES-256-CBC encryption with `ENCRYPTION_KEY` env var
- Stores username, password, PIN, TOTP secret (encrypted), and OTP email (plain)
- TOTP generation via `otpauth` library (Base32 secret, 6-digit, 30s period, SHA1)

### Gmail OTP Reader (`src/credentials/gmail-otp.service.ts`)
- OAuth2 refresh token flow (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)
- Searches recent emails (10min window) with OR query: `{to:email deliveredto:email email}`
- Extracts 4-8 digit OTP codes from subject + body
- Handles forwarded emails

---

## 7. Telegram Bot (`src/telegram/telegram.service.ts`)

- Long-polling (no SDK), inline keyboard for profile selection
- Restricted mode (default: `true`) with allowedChatIds + allowedUsernames
- PNG card rendering (`image-render.ts`) + HTML text formatting with currency conversions (USD/IDR) and fetch time
- Session-expired and access-denied alerts to `alertChatIds`
- Bot token stored in DB settings, updateable at runtime

### Currency Conversion (`src/common/currency.ts`)
- Platform currency mapping: CGAMING/ZOOMWLB → IDR, ONEOPSPORTAL → THB
- Converts amounts to USD and IDR using live exchange rates from `open.er-api.com`
- Rates cached for 4 hours
- Used by: Telegram card rendering, fetch result popup (via profiles controller)

---

## 8. Scheduler (`src/scheduler/scheduler.service.ts`)

- Cron-based fetch (runs `runAndSave` for all profiles) and refresh (keeps sessions alive)
- Per-profile running lock to prevent concurrent scrapes
- Configurable intervals via settings

### Daily Capture (`src/daily-capture/`)
- Runs at 00:15 ICT, captures yesterday's data for all profiles
- Startup catch-up with `onlyMissing` flag

---

## 9. Production Infrastructure

v1 runs at `scraper.200m.tech`, v2 at `scraper-v2.200m.tech` (side by side).

| Item | Value |
|---|---|
| **v1 domain** | `https://scraper.200m.tech` (port 3000) |
| **v2 domain** | `https://scraper-v2.200m.tech` (port 3001 web, 4001 api, 6090 noVNC) |
| **VPS** | DigitalOcean SGP1, 8 vCPU, 16 GB RAM, IP `159.89.201.35` |
| **v2 database** | DigitalOcean Managed PostgreSQL |
| **Reverse proxy** | Caddy on VPS (auto HTTPS, `handle_path /vnc/*` for noVNC) |
| **Docker** | `docker-compose.yml` — api (Playwright image + Xvfb/x11vnc/noVNC) + web (Node standalone) |
| **VNC** | noVNC via websockify; Caddy strips `/vnc/` prefix; client must pass `path=vnc/websockify` |

### Dashboard Layout Features
- VNC session banner in layout — polls `/api/vnc/session` every 10s, shows active user + "End VNC Session" button
- Fetch result popup — shows 6 metrics with USD/IDR currency conversions and fetch time

---

## 10. Conventions & Rules

- **Timezone:** `Asia/Bangkok` (GMT+7). Set at process level. All date logic uses this.
- **Plan-first:** For non-trivial work, explain approach and confirm before coding.
- **Credentials:** Always encrypted at rest. Never log decrypted values.
- **Scrapes:** Upsert by `(profileId, reportDate)` — idempotent.
- **Environment:** `.env` at project root, shared by all workspaces. Never commit it.
- **Imports:** Backend uses `@scraper/database` for Prisma types. Frontend uses `/api/*` proxy.
- **Numbers:** Display with comma formatting (`toLocaleString('en-US')`), parse strings with `parseFloat()` first.
- **Security:** All profile URLs validated against SSRF. Login rate-limited. Helmet + security headers enabled. CORS allowlisted.

---

## 11. Adding a New Module

1. Create folder `src/<name>/` with `*.module.ts`, `*.controller.ts`, `*.service.ts`, DTOs.
2. Import the module in `app.module.ts`.
3. Apply `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` as needed.
4. Add Prisma model if needed → edit `packages/database/prisma/schema.prisma` → `npm run db:generate`.
5. Cross-module dependencies: use `AppBootstrapService` (`src/app-bootstrap.service.ts`) for circular refs via setter injection.

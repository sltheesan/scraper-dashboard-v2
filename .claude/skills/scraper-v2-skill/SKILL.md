---
name: scraper-v2-skill
description: >-
  Reference for the Scraper Dashboard v2 project (NestJS + Next.js + PostgreSQL +
  Prisma monorepo). Use when working in this codebase to recall architecture,
  modules, database schema, auth/RBAC, conventions, and the phased roadmap.
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
└── .env              # Shared env (DATABASE_URL, JWT_SECRET, etc.)
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
| **AuthModule** | `src/auth/` | JWT login/register, `JwtStrategy`, `JwtAuthGuard`, `RolesGuard` |
| **ProfilesModule** | `src/profiles/` | Profile CRUD, role-gated (ADMIN can delete, OPERATOR can edit) |

### Auth & RBAC

- JWT Bearer token via `@nestjs/passport` + `passport-jwt`.
- Three roles: `ADMIN`, `OPERATOR`, `VIEWER`.
- Guards: `JwtAuthGuard` (is authenticated?), `RolesGuard` + `@Roles(...)` decorator (has role?).
- Login: `POST /api/auth/login` → `{ accessToken, user }`.
- Register: `POST /api/auth/register` → creates user (first user gets ADMIN role).
- Profile: `GET /api/auth/me` → current user info.

### Adding a new module

1. Create folder `src/<name>/` with `*.module.ts`, `*.controller.ts`, `*.service.ts`, DTOs.
2. Import the module in `app.module.ts`.
3. Apply `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` as needed.
4. Add Prisma model if needed → edit `packages/database/prisma/schema.prisma` → `npm run db:generate`.

---

## 3. Frontend (Next.js) — `apps/web/`

- App Router (`src/app/`), React 19, TypeScript.
- API calls proxy to backend via `next.config.ts` rewrites (`/api/*` → `localhost:4000`).
- Dark theme with CSS variables matching v1 palette (`--bg`, `--surface`, `--accent`, etc.).
- Port 3001 in dev.

---

## 4. Database (Prisma) — `packages/database/`

Schema: `prisma/schema.prisma`. Client exported from `src/index.ts` as `@scraper/database`.

### Models

| Model | Table | Key fields |
|---|---|---|
| **User** | `users` | `email`(unique), `name`, `passwordHash`, `role`(ADMIN\|OPERATOR\|VIEWER), `isActive` |
| **Profile** | `profiles` | `name`(unique), `kind`(CGAMING\|ZOOMWLB), `loginUrl`, `targetUrl`, `status`, timestamps |
| **ProfileCredential** | `profile_credentials` | 1:1 with Profile. `usernameEncrypted`, `passwordEncrypted`, `pinEncrypted`, `otpEmail` |
| **Scrape** | `scrapes` | `profileId`+`reportDate`(unique). 6 metrics: registration/deposit/withdrawal counts+amounts. `raw` JSON. |
| **Setting** | `settings` | `key`(unique), `value`(JSON). For scheduler config, telegram config, etc. |
| **ActivityLog** | `activity_logs` | `actorType`(USER\|TELEGRAM\|SYSTEM), `actorId`, `action`, `target`, `details`, `meta` |

### Conventions

- All IDs are `cuid()`.
- Amount fields use `Decimal(18,2)`.
- Credentials are AES-encrypted, keyed by `ENCRYPTION_KEY` env var.
- Scrapes are unique on `(profileId, reportDate)` — upsert, not insert.
- After schema changes: `npm run db:generate` then `npm run db:push` (dev) or `npm run db:migrate` (prod).

---

## 5. Production Infrastructure

v1 continues running at `https://scraper.200m.tech` until v2 is ready.

| Item | Value |
|---|---|
| **v1 domain** | `https://scraper.200m.tech` |
| **VPS** | DigitalOcean SGP1, 8 vCPU, 16 GB RAM, IP `159.89.201.35` |
| **v2 database** | DigitalOcean Managed PostgreSQL |
| **Reverse proxy** | Caddy on VPS |

---

## 6. Roadmap

| Phase | Status | What |
|---|---|---|
| **1. Foundation** | ✅ Scaffolded | Monorepo, NestJS, Next.js, Prisma, auth, RBAC, profile CRUD |
| **2. Scraper migration** | Planned | Move Playwright engine, parsers, scheduler, daily capture, Telegram from v1 |
| **3. Credentials + OTP** | Planned | Encrypted credential storage, Gmail OTP reader, auto-fill login |
| **4. Multi-user access** | Planned | User invites, per-profile visibility, audit trail |
| **5. Reports + charts** | Planned | Aggregations, trend charts, exports (CSV/PDF), scheduled reports |
| **6. Financial expansion** | Planned | Manual data entry, P&L, reconciliation, custom dashboards |

Full details in [README.md](../../../README.md).

---

## 7. Conventions & Rules

- **Timezone:** `Asia/Bangkok` (GMT+7). Set at process level. All date logic uses this.
- **Plan-first:** For non-trivial work, explain approach and confirm before coding.
- **Credentials:** Always encrypted at rest. Never log decrypted values.
- **Scrapes:** Upsert by `(profileId, reportDate)` — idempotent.
- **Environment:** `.env` at project root, shared by all workspaces. Never commit it.
- **Imports:** Backend uses `@scraper/database` for Prisma types. Frontend uses `/api/*` proxy.

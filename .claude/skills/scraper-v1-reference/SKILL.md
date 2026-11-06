---
name: scraper-v1-reference
description: >-
  Read-only reference for the v1 scraper system (Node/Fastify/Playwright/MongoDB).
  Use to understand v1 architecture, modules, parsers, scheduler, Telegram bot,
  and data models when porting functionality to v2.
---

# Dashboard Scraper v1 — Reference

A self-hosted system that keeps 20+ authenticated browser sessions alive
(Playwright + real Chrome), scrapes two site layouts (`cgaming`, `zoomwlb`),
archives daily totals to local MongoDB, and serves a web dashboard + Telegram
bot. **All timestamps are forced to Indochina Time (GMT+7, `Asia/Bangkok`).**

Production: `https://scraper.200m.tech` — Docker container on DigitalOcean VPS.

---

## Key Architecture

- **Context pool** (`contextPool.js`): One reusable `BrowserContext` per profile; auto-closes idle > 30 min.
- **Scraper** (`scraper.js`): `openContext`, `runFetch`, `runRefresh`, `persistCookies`, `fetchProfileData`.
- **Scrape runner** (`scrapeRunner.js`): `runAndParse` (read-only fetch+parse), `saveScrape` (upsert), `fetchYesterday` (DB-first, browser fallback).
- **Parsers**: cgaming (table-based, date-matching row), zoomwlb (element IDs, amount ×1000).
- **Scheduler** (`scheduler.js`): Two global schedules (fetch + refresh), per-profile running-lock, session-expired alerts on transition only.
- **Daily capture** (`dailyCapture.js`): 00:15 ICT, captures yesterday for all profiles, startup catch-up with `onlyMissing`.
- **Telegram** (`telegram.js`): Long-polling (no SDK), profile buttons → today/yesterday data, PNG card + text, session alerts to `alertChatIds`.
- **Log broker** (`logBroker.js`): In-memory ring buffer (200 events), SSE stream at `/api/logs/stream`.

## Common Data Schema (6 metrics)

`newRegistrationCount`, `newDepositCount`, `totalDepositCount`, `totalDepositAmount`, `totalWithdrawalCount`, `totalWithdrawalAmount`.

## API Routes (v1)

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST/PATCH/DELETE /api/profiles`, `POST /api/profiles/:id/login`, `POST /api/profiles/:id/fetch`
- `GET/PATCH /api/settings/scheduler`, `GET/PATCH /api/settings/telegram`, telegram chat/alert/username CRUD
- `GET /api/logs/stream` (SSE)
- `GET /api/activity` (paginated audit trail)
- `GET /api/backup/` (EJSON download), `POST /api/backup/restore`

## v1 Models → v2 Prisma Mapping

| v1 Collection | v2 Model | Notes |
|---|---|---|
| profiles | Profile | Added `proxy`, `notes`, `buttonSelector` fields |
| scrapes | Scrape | `data` object → flat columns on Scrape model |
| schedulesettings | Setting (key='scheduler') | Singleton → key-value in Settings table |
| telegramsettings | Setting (key='telegram') | Singleton → key-value in Settings table |
| activitylogs | ActivityLog | Same structure, added enum ActorType |

## Hazards

- **Backup restore** is destructive — v1 had a full wipe bug. v2 must validate before deleting.
- **Session folders** (`profiles/<name>/`) are NOT in DB — losing them means re-login.
- **Timezone**: everything GMT+7; all date logic must use `Asia/Bangkok`.

import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, BrowserContext, Page, Frame } from 'playwright';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { ProfileKind } from '@scraper/database';
import { PrismaService } from '../prisma/prisma.service';
import {
  FetchResult,
  TableInfo,
  reportDateFor,
} from './parsers/common';
import { parseCgaming, CgamingParseOptions } from './parsers/cgaming.parser';
import { parseZoomwlb, zoomwlbFieldIds } from './parsers/zoomwlb.parser';

interface ContextEntry {
  context: BrowserContext;
  profileId: string;
  profileName: string;
  lastUsed: number;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REAPER_INTERVAL_MS = 5 * 60 * 1000;
const NAV_TIMEOUT_MS = 30_000;
const COOKIE_FILE = 'session-cookies.json';
const PERSIST_LIFETIME_SECS = 30 * 24 * 3600;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

@Injectable()
export class ScraperService implements OnModuleDestroy {
  private readonly logger = new Logger(ScraperService.name);
  private readonly contexts = new Map<string, ContextEntry>();
  private readonly pending = new Map<string, Promise<BrowserContext>>();
  private readonly running = new Set<string>();
  private readonly loginSessions = new Map<string, BrowserContext>();
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private readonly profilesRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.profilesRoot = join(process.cwd(), 'profiles');
    this.startReaper();
  }

  async onModuleDestroy() {
    this.stopReaper();
    await this.closeAllContexts();
    for (const [, ctx] of this.loginSessions) {
      try { await ctx.close(); } catch {}
    }
    this.loginSessions.clear();
  }

  isRunning(profileId: string): boolean {
    return this.running.has(profileId);
  }

  private profileDir(profile: { name: string; userDataDir?: string }): string {
    return profile.userDataDir || join(this.profilesRoot, profile.name);
  }

  private cookieFilePath(profile: { name: string; userDataDir?: string }): string {
    return join(this.profileDir(profile), COOKIE_FILE);
  }

  async persistCookies(
    profile: { name: string; userDataDir?: string },
    context: BrowserContext,
  ): Promise<number> {
    const cookies = await context.cookies();
    const now = Math.floor(Date.now() / 1000);
    const persisted = cookies.map((c) => {
      if (!c.expires || c.expires < 0) {
        return { ...c, expires: now + PERSIST_LIFETIME_SECS };
      }
      return c;
    });
    const dir = this.profileDir(profile);
    await mkdir(dir, { recursive: true });
    await writeFile(this.cookieFilePath(profile), JSON.stringify(persisted, null, 2));
    return persisted.length;
  }

  private async restoreCookies(
    profile: { name: string; userDataDir?: string },
    context: BrowserContext,
  ): Promise<number> {
    try {
      const raw = await readFile(this.cookieFilePath(profile), 'utf8');
      const cookies = JSON.parse(raw);
      if (Array.isArray(cookies) && cookies.length) {
        await context.addCookies(cookies);
        return cookies.length;
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    return 0;
  }

  async openContext(profile: {
    id: string;
    name: string;
    proxy?: string;
    userDataDir?: string;
  }): Promise<BrowserContext> {
    const existing = this.contexts.get(profile.id);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.context;
    }

    if (this.pending.has(profile.id)) {
      return this.pending.get(profile.id)!;
    }

    const promise = this.launchContext(profile)
      .then((context) => {
        this.contexts.set(profile.id, {
          context,
          profileId: profile.id,
          profileName: profile.name,
          lastUsed: Date.now(),
        });
        this.pending.delete(profile.id);
        context.on('close', () => {
          if (this.contexts.get(profile.id)?.context === context) {
            this.contexts.delete(profile.id);
          }
        });
        return context;
      })
      .catch((err) => {
        this.pending.delete(profile.id);
        throw err;
      });

    this.pending.set(profile.id, promise);
    return promise;
  }

  private async launchContext(profile: {
    id: string;
    name: string;
    proxy?: string;
    userDataDir?: string;
  }): Promise<BrowserContext> {
    const userDataDir = this.profileDir(profile);
    await mkdir(userDataDir, { recursive: true });

    const headless = this.config.get('HEADLESS', 'true') === 'true';
    const channel = this.config.get('BROWSER_CHANNEL', 'chrome');

    const launchOpts: any = {
      headless,
      viewport: { width: 1366, height: 850 },
      userAgent: USER_AGENT,
      locale: 'en-US',
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    if (channel) launchOpts.channel = channel;
    if (profile.proxy) launchOpts.proxy = { server: profile.proxy };

    const context = await chromium.launchPersistentContext(userDataDir, launchOpts);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    this.logger.log(`Context opened for ${profile.name}`);
    return context;
  }

  getContext(profileId: string): BrowserContext | null {
    const entry = this.contexts.get(profileId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.context;
    }
    return null;
  }

  async closeContext(profileId: string): Promise<void> {
    const entry = this.contexts.get(profileId);
    if (!entry) return;
    this.contexts.delete(profileId);
    try {
      await entry.context.close();
      this.logger.log(`Context closed for ${entry.profileName}`);
    } catch (err) {
      this.logger.warn(`Error closing context for ${entry.profileName}: ${err}`);
    }
  }

  async closeAllContexts(): Promise<void> {
    const ids = [...this.contexts.keys()];
    await Promise.allSettled(ids.map((id) => this.closeContext(id)));
  }

  private async looksLikeLoginPage(page: Page, targetUrl: string): Promise<boolean> {
    try {
      const currentUrl = page.url();
      const targetHost = new URL(targetUrl).host;
      const currentHost = new URL(currentUrl).host;
      if (currentHost !== targetHost) return true;

      const currentPath = new URL(currentUrl).pathname.toLowerCase();
      const targetPath = new URL(targetUrl).pathname.toLowerCase();
      if (currentPath !== targetPath && /login|signin|auth/.test(currentPath)) {
        return true;
      }

      const hasPassword = await page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false);
      return hasPassword;
    } catch {
      return false;
    }
  }

  private async looksLikeAccessDenied(page: Page): Promise<boolean> {
    try {
      if (/access[_-]?denied/i.test(page.url())) return true;
      const title = await page.title().catch(() => '');
      return /access\s*denied/i.test(title);
    } catch {
      return false;
    }
  }

  private async extractTablesInFrame(frame: Frame): Promise<TableInfo[]> {
    const tables = await frame.evaluate(() => {
      const text = (el: any) => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return [...document.querySelectorAll('table')].map((table) => {
        let headers: string[] = [];
        const theadCells = table.querySelectorAll('thead th, thead td');
        if (theadCells.length) {
          headers = [...theadCells].map(text);
        } else {
          const firstRow = table.querySelector('tr');
          if (firstRow) headers = [...firstRow.querySelectorAll('th, td')].map(text);
        }
        const bodyRows = table.tBodies.length
          ? [...table.tBodies].flatMap((tb) => [...tb.rows])
          : [...table.rows].slice(headers.length ? 1 : 0);
        const rows = bodyRows.map((tr) => [...tr.cells].map(text));
        return {
          id: table.id || undefined,
          className: table.className || undefined,
          headers,
          rowCount: rows.length,
          rows,
        };
      });
    });
    return tables.map((t) => ({ ...t, frameUrl: frame.url() }));
  }

  private async extractAllTables(page: Page): Promise<TableInfo[]> {
    const all: TableInfo[] = [];
    for (const frame of page.frames()) {
      try {
        const ts = await this.extractTablesInFrame(frame);
        all.push(...ts);
      } catch {
        // Cross-origin or detached frames
      }
    }
    return all;
  }

  private async extractDataFields(
    page: Page,
    dataFields: Array<{ id: string; label: string }>,
  ): Promise<Record<string, string | null>> {
    if (!dataFields?.length) return {};
    const plain = dataFields.map((f) => ({ id: f.id, label: f.label }));
    const out: Record<string, string | null> = Object.fromEntries(
      plain.map((f) => [f.label, null]),
    );

    for (const frame of page.frames()) {
      try {
        const found: Record<string, string> = await frame.evaluate((fields: any[]) => {
          const cleanText = (s: string) => {
            let t = (s ?? '').replace(/\s+/g, ' ').trim();
            while (t.startsWith('[') && t.endsWith(']')) {
              t = t.slice(1, -1).trim();
            }
            return t;
          };
          const r: Record<string, string> = {};
          for (const { id, label } of fields) {
            const el = document.getElementById(id);
            if (el) r[label] = cleanText((el as HTMLElement).innerText ?? el.textContent ?? '');
          }
          return r;
        }, plain);
        for (const [k, v] of Object.entries(found)) {
          if (out[k] == null && v != null) out[k] = v;
        }
      } catch {
        // Cross-origin or detached frame
      }
    }
    return out;
  }

  // --- Manual login flow ---

  async startLogin(profile: {
    id: string;
    name: string;
    loginUrl: string;
    proxy?: string;
    userDataDir?: string;
  }): Promise<{ alreadyOpen: boolean }> {
    if (this.loginSessions.has(profile.id)) {
      return { alreadyOpen: true };
    }

    await this.closeContext(profile.id);

    const userDataDir = this.profileDir(profile);
    await mkdir(userDataDir, { recursive: true });
    const channel = this.config.get('BROWSER_CHANNEL', 'chrome');

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel,
      headless: false,
      userAgent: USER_AGENT,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
      viewport: { width: 1366, height: 850 },
    } as any);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(profile.loginUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    this.loginSessions.set(profile.id, context);
    context.on('close', () => {
      this.loginSessions.delete(profile.id);
      this.prisma.profile.update({
        where: { id: profile.id },
        data: { status: 'LOGGED_IN', lastLoginAt: new Date() },
      }).catch(() => {});
    });

    return { alreadyOpen: false };
  }

  async finishLogin(profile: {
    id: string;
    name: string;
    userDataDir?: string;
  }): Promise<void> {
    const context = this.loginSessions.get(profile.id);
    if (!context) throw new Error('No login session open for this profile');

    await this.persistCookies(profile, context);
    this.loginSessions.delete(profile.id);
    try { await context.close(); } catch {}
  }

  async cancelLogin(profileId: string): Promise<void> {
    const context = this.loginSessions.get(profileId);
    if (!context) return;
    this.loginSessions.delete(profileId);
    try { await context.close(); } catch {}
  }

  hasLoginSession(profileId: string): boolean {
    return this.loginSessions.has(profileId);
  }

  // --- Fetch ---

  async runFetch(
    profile: {
      id: string;
      name: string;
      kind: ProfileKind;
      targetUrl: string;
      buttonSelector?: string;
      proxy?: string;
      userDataDir?: string;
      dataFields?: any;
    },
    period: 'today' | 'yesterday',
    cutover: string = '11:00',
    todayMissing: string = 'calm',
  ): Promise<FetchResult> {
    if (this.running.has(profile.id)) {
      return { loggedIn: true, error: 'Already running' };
    }
    this.running.add(profile.id);

    try {
      const context = await this.openContext(profile);
      await this.restoreCookies(profile, context);

      const page = context.pages()[0] || (await context.newPage());

      await page.goto(profile.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      if (await this.looksLikeLoginPage(page, profile.targetUrl)) {
        return {
          loggedIn: false,
          url: page.url(),
          message: 'Profile session is missing or expired. Click Login on this profile to refresh it.',
        };
      }

      if (await this.looksLikeAccessDenied(page)) {
        return {
          loggedIn: false,
          accessDenied: true,
          url: page.url(),
          title: await page.title().catch(() => ''),
          message: 'Access denied — the account is not authorized to view the report. Re-login this profile, or check its permission / IP allowlist.',
        };
      }

      if (profile.buttonSelector) {
        try {
          const btn = page.locator(profile.buttonSelector).first();
          await btn.waitFor({ state: 'visible', timeout: 15000 });
          await btn.click();
        } catch {
          // Button may not exist
        }
      }

      const parsedDataFields: Array<{ id: string; label: string }> =
        Array.isArray(profile.dataFields) ? profile.dataFields : [];

      const zoomwlbIds = profile.kind === 'ZOOMWLB' ? zoomwlbFieldIds(period) : null;

      // Wait for data to appear
      if (profile.kind === 'ZOOMWLB') {
        const expectedIds = Object.values(zoomwlbIds!);
        const waits: Promise<any>[] = [];
        for (const frame of page.frames()) {
          for (const id of expectedIds) {
            waits.push(frame.waitForSelector(`#${id}`, { timeout: 20000 }).catch(() => null));
          }
        }
        if (waits.length) await Promise.race(waits);
      } else {
        await Promise.race([
          page.waitForSelector('table tbody tr', { timeout: 20000 }).catch(() => null),
          ...page.frames().map((f) =>
            f.waitForSelector('table tbody tr', { timeout: 20000 }).catch(() => null),
          ),
        ]);
      }
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // For zoomwlb, use fixed common-schema IDs; for others, use per-profile dataFields
      const fieldDefs =
        profile.kind === 'ZOOMWLB'
          ? Object.entries(zoomwlbIds!).map(([commonKey, id]) => ({ id, label: commonKey }))
          : parsedDataFields;

      const [tables, fields, title] = await Promise.all([
        this.extractAllTables(page),
        this.extractDataFields(page, fieldDefs),
        page.title().catch(() => ''),
      ]);

      await this.persistCookies(profile, context).catch(() => {});

      const targetDate = reportDateFor(period, cutover);
      const url = page.url();
      const frameCount = page.frames().length;

      if (profile.kind === 'CGAMING') {
        const parsed = parseCgaming(tables as TableInfo[], {
          targetDate,
          cutover,
          allowFallback: period === 'today' && todayMissing === 'fallback',
        });
        return { loggedIn: true, parsed: parsed ?? undefined, url, title, frameCount, tables, fields, kind: 'CGAMING' };
      } else {
        const parsed = parseZoomwlb(fields as Record<string, string | null>, targetDate);
        return { loggedIn: true, parsed: parsed ?? undefined, url, title, frameCount, tables, fields, kind: 'ZOOMWLB' };
      }
    } catch (err: any) {
      this.logger.error(`Fetch failed for ${profile.name}: ${err.message}`);
      return { loggedIn: true, error: err.message };
    } finally {
      this.running.delete(profile.id);
    }
  }

  async runRefresh(
    profile: {
      id: string;
      name: string;
      targetUrl: string;
      proxy?: string;
      userDataDir?: string;
    },
  ): Promise<{ loggedIn: boolean; accessDenied?: boolean; error?: string }> {
    if (this.running.has(profile.id)) {
      return { loggedIn: true, error: 'Already running' };
    }
    this.running.add(profile.id);

    try {
      const context = await this.openContext(profile);
      await this.restoreCookies(profile, context);

      const page = context.pages()[0] || (await context.newPage());

      await page.goto(profile.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      if (await this.looksLikeAccessDenied(page)) {
        return { loggedIn: false, accessDenied: true };
      }

      if (await this.looksLikeLoginPage(page, profile.targetUrl)) {
        return { loggedIn: false };
      }

      return { loggedIn: true };
    } catch (err: any) {
      this.logger.error(`Refresh failed for ${profile.name}: ${err.message}`);
      return { loggedIn: true, error: err.message };
    } finally {
      this.running.delete(profile.id);
    }
  }

  private startReaper(): void {
    this.reaperTimer = setInterval(() => this.reapIdleContexts(), REAPER_INTERVAL_MS);
  }

  private stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  private async reapIdleContexts(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.contexts) {
      if (now - entry.lastUsed > IDLE_TIMEOUT_MS && !this.running.has(id)) {
        this.logger.log(`Reaping idle context: ${entry.profileName}`);
        await this.closeContext(id);
      }
    }
  }
}

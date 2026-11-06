import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';

export interface SchedulerSettings {
  fetch: { enabled: boolean; intervalMs: number };
  refresh: { enabled: boolean; intervalMs: number };
  platforms?: Record<string, { dayCutover: string; todayMissing: string }>;
}

const DEFAULT_SETTINGS: SchedulerSettings = {
  fetch: { enabled: false, intervalMs: 300_000 },
  refresh: { enabled: false, intervalMs: 300_000 },
};

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly fetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<string>();
  private readonly previousStatus = new Map<string, string>();
  private settings: SchedulerSettings = { ...DEFAULT_SETTINGS };
  private started = false;

  private scrapesService: any = null;
  private scraperService: any = null;
  private telegramService: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
  ) {}

  setScrapesService(service: any) { this.scrapesService = service; }
  setScraperService(service: any) { this.scraperService = service; }
  setTelegramService(service: any) { this.telegramService = service; }

  async onModuleInit() {
    await this.loadSettings();
    this.started = true;
    await this.rescheduleAll();
    this.logger.log('Scheduler initialized');
    this.logs.logEvent({ type: 'scheduler', message: this.describeSettings('Scheduler started — ') });
  }

  onModuleDestroy() {
    this.stop();
  }

  private describeSettings(prefix: string): string {
    const parts: string[] = [];
    parts.push(`fetch ${this.settings.fetch.enabled ? `every ${Math.round(this.settings.fetch.intervalMs / 60000)} min` : 'off'}`);
    parts.push(`refresh ${this.settings.refresh.enabled ? `every ${Math.round(this.settings.refresh.intervalMs / 60000)} min` : 'off'}`);
    return prefix + parts.join(', ');
  }

  async loadSettings(): Promise<SchedulerSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'scheduler' } });
    if (row) {
      this.settings = row.value as unknown as SchedulerSettings;
    }
    return this.settings;
  }

  stop() {
    this.started = false;
    for (const t of this.fetchTimers.values()) clearTimeout(t);
    for (const t of this.refreshTimers.values()) clearTimeout(t);
    this.fetchTimers.clear();
    this.refreshTimers.clear();
  }

  async rescheduleAll() {
    this.stop();
    this.started = true;
    const profiles = await this.prisma.profile.findMany();
    for (const p of profiles) {
      this.scheduleProfile(p);
    }
  }

  async applySettings(next: SchedulerSettings) {
    await this.prisma.setting.upsert({
      where: { key: 'scheduler' },
      create: { key: 'scheduler', value: next as any },
      update: { value: next as any },
    });
    this.settings = next;
    await this.rescheduleAll();
    this.logs.logEvent({ type: 'scheduler', message: this.describeSettings('Settings updated — ') });
  }

  getSnapshot() {
    return {
      settings: this.settings,
      fetchTimers: this.fetchTimers.size,
      refreshTimers: this.refreshTimers.size,
      runningCount: this.running.size,
    };
  }

  isRunning(profileId: string): boolean {
    return this.running.has(profileId);
  }

  private scheduleProfile(profile: { id: string }) {
    this.scheduleFetch(profile.id);
    this.scheduleRefresh(profile.id);
  }

  private clearTimer(map: Map<string, ReturnType<typeof setTimeout>>, id: string) {
    const t = map.get(id);
    if (t) { clearTimeout(t); map.delete(id); }
  }

  private scheduleFetch(profileId: string) {
    this.clearTimer(this.fetchTimers, profileId);
    if (!this.started || !this.settings.fetch.enabled) return;
    const delay = this.settings.fetch.intervalMs + Math.floor(Math.random() * 1000);
    this.fetchTimers.set(profileId, setTimeout(() => this.runFetchTick(profileId), delay));
  }

  private scheduleRefresh(profileId: string) {
    this.clearTimer(this.refreshTimers, profileId);
    if (!this.started || !this.settings.refresh.enabled) return;
    const delay = this.settings.refresh.intervalMs + Math.floor(Math.random() * 1000);
    this.refreshTimers.set(profileId, setTimeout(() => this.runRefreshTick(profileId), delay));
  }

  private async runFetchTick(profileId: string) {
    this.fetchTimers.delete(profileId);
    if (this.running.has(profileId)) {
      this.scheduleFetch(profileId);
      return;
    }
    this.running.add(profileId);

    let profileName: string | undefined;
    try {
      if (!this.scrapesService) return;
      const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
      if (!profile || !this.settings.fetch.enabled) return;
      profileName = profile.name;

      this.logs.logEvent({ type: 'fetch', profileId, message: `Scheduled fetch starting for ${profile.name}` });

      const result = await this.scrapesService.runAndSave(profile, 'today');

      if (!result.loggedIn && result.accessDenied) {
        const wasDenied = this.previousStatus.get(profileId) === 'ACCESS_DENIED';
        this.previousStatus.set(profileId, 'ACCESS_DENIED');
        this.logs.logEvent({ type: 'fetch', profileId, message: `${profile.name}: access denied` });
        if (!wasDenied && this.telegramService) {
          this.telegramService.sendAccessDeniedAlert?.(profile, 'scheduled fetch').catch(() => {});
        }
      } else if (!result.loggedIn) {
        const wasOut = this.previousStatus.get(profileId) === 'LOGGED_OUT';
        this.previousStatus.set(profileId, 'LOGGED_OUT');
        this.logs.logEvent({ type: 'fetch', profileId, message: `${profile.name}: session expired` });
        if (!wasOut && this.telegramService) {
          this.telegramService.sendSessionAlert(profile, 'scheduled fetch').catch(() => {});
        }
      } else {
        this.previousStatus.set(profileId, 'LOGGED_IN');
        this.logs.logEvent({
          type: 'fetch',
          profileId,
          message: result.scrape ? `${profile.name}: scraped + saved` : `${profile.name}: no data`,
        });
      }
    } catch (err: any) {
      this.logger.error(`Scheduled fetch failed for ${profileName || profileId}: ${err.message}`);
      this.logs.logEvent({ type: 'error', profileId, message: `Fetch error: ${err.message}` });
    } finally {
      this.running.delete(profileId);
      this.scheduleFetch(profileId);
    }
  }

  private async runRefreshTick(profileId: string) {
    this.refreshTimers.delete(profileId);
    if (this.running.has(profileId)) {
      this.scheduleRefresh(profileId);
      return;
    }
    this.running.add(profileId);

    let profileName: string | undefined;
    try {
      if (!this.scraperService) return;
      const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
      if (!profile || !this.settings.refresh.enabled) return;
      profileName = profile.name;

      this.logs.logEvent({ type: 'refresh', profileId, message: `Refresh tick for ${profile.name}` });

      const result = await this.scraperService.runRefresh(profile);

      if (!result.loggedIn && result.accessDenied) {
        const wasDenied = this.previousStatus.get(profileId) === 'ACCESS_DENIED';
        await this.prisma.profile.update({ where: { id: profileId }, data: { status: 'ACCESS_DENIED' } });
        this.previousStatus.set(profileId, 'ACCESS_DENIED');
        this.logs.logEvent({ type: 'refresh', profileId, message: `${profile.name}: access denied` });
        if (!wasDenied && this.telegramService) {
          this.telegramService.sendAccessDeniedAlert?.(profile, 'session refresh').catch(() => {});
        }
      } else if (!result.loggedIn) {
        const wasOut = this.previousStatus.get(profileId) === 'LOGGED_OUT';
        await this.prisma.profile.update({ where: { id: profileId }, data: { status: 'LOGGED_OUT' } });
        this.previousStatus.set(profileId, 'LOGGED_OUT');
        this.logs.logEvent({ type: 'refresh', profileId, message: `${profile.name}: session expired` });
        if (!wasOut && this.telegramService) {
          this.telegramService.sendSessionAlert(profile, 'session refresh').catch(() => {});
        }
      } else {
        await this.prisma.profile.update({
          where: { id: profileId },
          data: { status: 'LOGGED_IN', lastLoginAt: new Date() },
        });
        this.previousStatus.set(profileId, 'LOGGED_IN');
        this.logs.logEvent({ type: 'refresh', profileId, message: `${profile.name}: session refreshed` });
      }
    } catch (err: any) {
      this.logger.error(`Refresh tick failed for ${profileName || profileId}: ${err.message}`);
      this.logs.logEvent({ type: 'error', profileId, message: `Refresh error: ${err.message}` });
    } finally {
      this.running.delete(profileId);
      this.scheduleRefresh(profileId);
    }
  }
}

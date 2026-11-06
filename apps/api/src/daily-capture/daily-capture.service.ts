import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { SettingsService } from '../settings/settings.service';
import { yesterdayReportDate } from '../scraper/parsers/common';
import { msUntilCutover } from '../common/business-day';

const CAPTURE_OFFSET_MIN = 15;
const GAP_MS = 1500;
const STARTUP_DELAY_MS = 15_000;
const KINDS = ['CGAMING', 'ZOOMWLB'] as const;

@Injectable()
export class DailyCaptureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyCaptureService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly runningKinds = new Set<string>();
  private readonly previousStatus = new Map<string, string>();
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private scrapesService: any = null;
  private telegramService: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
    private readonly settings: SettingsService,
  ) {}

  setScrapesService(service: any) { this.scrapesService = service; }
  setTelegramService(service: any) { this.telegramService = service; }

  onModuleInit() {
    this.rescheduleDailyCapture().catch((err) =>
      this.logger.error(`Daily capture scheduling failed: ${err.message}`),
    );
    this.startupTimer = setTimeout(() => {
      this.captureYesterdayAll(true).catch((err) =>
        this.logger.error(`Startup catch-up failed: ${err.message}`),
      );
    }, STARTUP_DELAY_MS);
    this.logger.log(`Daily capture scheduled at cutover + ${CAPTURE_OFFSET_MIN} min per platform`);
  }

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  async rescheduleDailyCapture() {
    for (const kind of KINDS) {
      await this.scheduleKind(kind);
    }
  }

  private async scheduleKind(kind: string) {
    const existing = this.timers.get(kind);
    if (existing) clearTimeout(existing);

    const { dayCutover } = await this.settings.getPlatformConfig(kind);
    const delay = msUntilCutover(new Date(), dayCutover, CAPTURE_OFFSET_MIN);
    const delayMin = Math.round(delay / 60_000);

    this.logger.log(`${kind} daily capture in ${delayMin} minutes (cutover ${dayCutover} + ${CAPTURE_OFFSET_MIN}m)`);

    this.timers.set(kind, setTimeout(() => {
      this.captureKind(kind, false)
        .catch((err) => this.logger.error(`Daily capture (${kind}) failed: ${err.message}`))
        .finally(() => { this.scheduleKind(kind).catch(() => {}); });
    }, delay));
  }

  async captureYesterdayAll(onlyMissing: boolean) {
    for (const kind of KINDS) {
      await this.captureKind(kind, onlyMissing);
    }
  }

  private async captureKind(kind: string, onlyMissing: boolean) {
    if (this.runningKinds.has(kind)) return;
    this.runningKinds.add(kind);

    try {
      if (!this.scrapesService) {
        this.logger.warn('ScrapesService not available, skipping capture');
        return;
      }

      const { dayCutover } = await this.settings.getPlatformConfig(kind);
      const rd = yesterdayReportDate(dayCutover);

      const profiles = await this.prisma.profile.findMany({
        where: { kind: kind as any },
      });

      let captured = 0;
      for (const profile of profiles) {
        if (onlyMissing) {
          const exists = await this.prisma.scrape.findUnique({
            where: { profileId_reportDate: { profileId: profile.id, reportDate: rd } },
          });
          if (exists) continue;
        }

        try {
          const result = await this.scrapesService.runAndSave(profile, 'yesterday');
          if (!result.loggedIn) {
            if (result.accessDenied) {
              const wasDenied = this.previousStatus.get(profile.id) === 'ACCESS_DENIED';
              this.previousStatus.set(profile.id, 'ACCESS_DENIED');
              this.logs.logEvent({ type: 'capture', profileId: profile.id, message: `${profile.name}: access denied` });
              if (!wasDenied && this.telegramService) {
                this.telegramService.sendAccessDeniedAlert?.(profile, 'daily capture').catch(() => {});
              }
            } else {
              const wasOut = this.previousStatus.get(profile.id) === 'LOGGED_OUT';
              this.previousStatus.set(profile.id, 'LOGGED_OUT');
              this.logs.logEvent({ type: 'capture', profileId: profile.id, message: `${profile.name}: session expired` });
              if (!wasOut && this.telegramService) {
                this.telegramService.sendSessionAlert(profile, 'daily capture').catch(() => {});
              }
            }
          } else {
            this.previousStatus.set(profile.id, 'LOGGED_IN');
            captured++;
            this.logs.logEvent({ type: 'capture', profileId: profile.id, message: `${profile.name}: yesterday archived` });
          }
        } catch (err: any) {
          this.logger.error(`Capture failed for ${profile.name}: ${err.message}`);
          this.logs.logEvent({ type: 'error', profileId: profile.id, message: `Capture failed: ${err.message}` });
        }

        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      if (captured) {
        this.logs.logEvent({
          type: 'capture',
          message: `Yesterday archive (${kind}) complete — ${captured} profile${captured === 1 ? '' : 's'}`,
        });
      }
    } finally {
      this.runningKinds.delete(kind);
    }
  }
}

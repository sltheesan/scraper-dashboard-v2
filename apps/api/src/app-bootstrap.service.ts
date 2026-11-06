import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SchedulerService } from './scheduler/scheduler.service';
import { DailyCaptureService } from './daily-capture/daily-capture.service';
import { ScrapesService } from './scrapes/scrapes.service';
import { ScraperService } from './scraper/scraper.service';
import { TelegramService } from './telegram/telegram.service';
import { SettingsController } from './settings/settings.controller';
import { ProfilesController } from './profiles/profiles.controller';
import { BackupService } from './backup/backup.service';

@Injectable()
export class AppBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly scheduler: SchedulerService,
    private readonly dailyCapture: DailyCaptureService,
    private readonly scrapes: ScrapesService,
    private readonly scraper: ScraperService,
    private readonly telegram: TelegramService,
    private readonly backup: BackupService,
  ) {}

  onApplicationBootstrap() {
    this.scheduler.setScrapesService(this.scrapes);
    this.scheduler.setScraperService(this.scraper);
    this.scheduler.setTelegramService(this.telegram);
    this.dailyCapture.setScrapesService(this.scrapes);
    this.dailyCapture.setTelegramService(this.telegram);
    this.telegram.setScrapesService(this.scrapes);
    this.telegram.setScraperService(this.scraper);

    this.backup.setSchedulerService(this.scheduler);

    try {
      const settingsCtrl = this.moduleRef.get(SettingsController, { strict: false });
      settingsCtrl.setTelegramService(this.telegram);
      settingsCtrl.setSchedulerService(this.scheduler);
      settingsCtrl.setDailyCaptureService(this.dailyCapture);
    } catch {}

    try {
      const profilesCtrl = this.moduleRef.get(ProfilesController, { strict: false });
      profilesCtrl.setSchedulerService(this.scheduler);
      profilesCtrl.setTelegramService(this.telegram);
    } catch {}
  }
}

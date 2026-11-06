import { Injectable, Logger } from '@nestjs/common';
import { ProfileKind } from '@scraper/database';
import { PrismaService } from '../prisma/prisma.service';
import { ScraperService } from '../scraper/scraper.service';
import { SettingsService } from '../settings/settings.service';
import {
  FetchResult,
  ParseResult,
  todayReportDate,
  yesterdayReportDate,
} from '../scraper/parsers/common';

@Injectable()
export class ScrapesService {
  private readonly logger = new Logger(ScrapesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: ScraperService,
    private readonly settings: SettingsService,
  ) {}

  async saveScrape(
    profileId: string,
    kind: ProfileKind,
    parsed: ParseResult,
    tables?: any,
  ) {
    const fields = {
      newRegistrationCount: parsed.data.newRegistrationCount,
      newDepositCount: parsed.data.newDepositCount,
      totalDepositCount: parsed.data.totalDepositCount,
      totalDepositAmount: parsed.data.totalDepositAmount,
      totalWithdrawalCount: parsed.data.totalWithdrawalCount,
      totalWithdrawalAmount: parsed.data.totalWithdrawalAmount,
      raw: parsed.raw ?? undefined,
      tables: tables ?? undefined,
    };

    return this.prisma.scrape.upsert({
      where: {
        profileId_reportDate: {
          profileId,
          reportDate: parsed.reportDate,
        },
      },
      create: {
        profileId,
        kind,
        reportDate: parsed.reportDate,
        reportDateString: parsed.reportDateString,
        ...fields,
      },
      update: fields,
    });
  }

  async runAndSave(
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
  ): Promise<FetchResult & { scrape?: any }> {
    const { dayCutover, todayMissing } = await this.settings.getPlatformConfig(profile.kind);
    const result = await this.scraper.runFetch(profile, period, dayCutover, todayMissing);

    if (!result.loggedIn) {
      const status = result.accessDenied ? 'ACCESS_DENIED' : 'LOGGED_OUT';
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { status },
      });
      return result;
    }

    if (result.error || !result.parsed) {
      return result;
    }

    const scrape = await this.saveScrape(profile.id, profile.kind, result.parsed, result.tables);

    await this.prisma.profile.update({
      where: { id: profile.id },
      data: {
        status: 'LOGGED_IN',
        lastScrapeAt: new Date(),
      },
    });

    this.logger.log(
      `Saved scrape for ${profile.name} (${period}): ${result.parsed.reportDateString}`,
    );

    return { ...result, scrape };
  }

  async fetchYesterday(profile: {
    id: string;
    name: string;
    kind: ProfileKind;
    targetUrl: string;
    buttonSelector?: string;
    proxy?: string;
    userDataDir?: string;
    dataFields?: any;
  }) {
    const { dayCutover } = await this.settings.getPlatformConfig(profile.kind);
    const reportDate = yesterdayReportDate(dayCutover);

    const existing = await this.prisma.scrape.findUnique({
      where: {
        profileId_reportDate: {
          profileId: profile.id,
          reportDate,
        },
      },
    });

    if (existing) {
      return { cached: true, loggedIn: true, scrape: existing };
    }

    return this.runAndSave(profile, 'yesterday');
  }

  async getByPeriod(profileId: string, period: string) {
    const kind = (await this.prisma.profile.findUnique({ where: { id: profileId } }))?.kind;
    const cutover = kind ? (await this.settings.getPlatformConfig(kind)).dayCutover : '11:00';

    if (period === 'yesterday') {
      return this.prisma.scrape.findUnique({
        where: {
          profileId_reportDate: {
            profileId,
            reportDate: yesterdayReportDate(cutover),
          },
        },
      });
    }
    return this.prisma.scrape.findUnique({
      where: {
        profileId_reportDate: {
          profileId,
          reportDate: todayReportDate(cutover),
        },
      },
    });
  }

  async getToday(profileId: string) {
    return this.prisma.scrape.findUnique({
      where: {
        profileId_reportDate: {
          profileId,
          reportDate: todayReportDate(),
        },
      },
    });
  }

  async getYesterday(profileId: string) {
    return this.prisma.scrape.findUnique({
      where: {
        profileId_reportDate: {
          profileId,
          reportDate: yesterdayReportDate(),
        },
      },
    });
  }

  async getByDateRange(profileId: string, from: Date, to: Date) {
    return this.prisma.scrape.findMany({
      where: {
        profileId,
        reportDate: { gte: from, lte: to },
      },
      orderBy: { reportDate: 'asc' },
    });
  }

  async getLatest(profileId: string, limit = 30) {
    return this.prisma.scrape.findMany({
      where: { profileId },
      orderBy: { reportDate: 'desc' },
      take: limit,
    });
  }

  async getAllToday() {
    const reportDate = todayReportDate();
    return this.prisma.scrape.findMany({
      where: { reportDate },
      include: { profile: { select: { name: true, kind: true } } },
      orderBy: { profile: { name: 'asc' } },
    });
  }
}

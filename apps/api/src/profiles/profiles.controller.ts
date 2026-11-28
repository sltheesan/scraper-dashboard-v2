import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { ScraperService } from '../scraper/scraper.service';
import { ScrapesService } from '../scrapes/scrapes.service';
import { ActivityService } from '../activity/activity.service';
import { LogsService } from '../logs/logs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrivilegesGuard, Privileges } from '../auth/privileges.guard';
import { validateProfileUrl, validateProxyUrl } from '../common/url-validator';
import { currencyForPlatform, getExchangeRates, convertedLabels } from '../common/currency';

@Controller('profiles')
@UseGuards(JwtAuthGuard, PrivilegesGuard)
@ApiBearerAuth()
export class ProfilesController {
  private schedulerService: any = null;
  private telegramService: any = null;

  constructor(
    private readonly profiles: ProfilesService,
    private readonly scraper: ScraperService,
    private readonly scrapes: ScrapesService,
    private readonly activity: ActivityService,
    private readonly logs: LogsService,
  ) {}

  setSchedulerService(service: any) { this.schedulerService = service; }
  setTelegramService(service: any) { this.telegramService = service; }

  @Get()
  @Privileges('profiles.view')
  findAll() {
    return this.profiles.findAll();
  }

  @Get(':id')
  @Privileges('profiles.view')
  findOne(@Param('id') id: string) {
    return this.profiles.findOne(id);
  }

  @Post()
  @Privileges('profiles.create')
  async create(@Req() req: any, @Body() body: any) {
    if (body.loginUrl) validateProfileUrl(body.loginUrl, 'loginUrl');
    if (body.targetUrl) validateProfileUrl(body.targetUrl, 'targetUrl');
    if (body.proxy) validateProxyUrl(body.proxy);
    try {
      const profile = await this.profiles.create(body);
      this.activity.recordActivity({
        actorType: 'USER',
        actorId: req.user?.sub,
        action: 'profile.create',
        target: profile.name,
        details: `kind=${profile.kind}`,
      });
      this.schedulerService?.rescheduleAll?.();
      return profile;
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Profile name already exists');
      }
      throw err;
    }
  }

  @Patch(':id')
  @Privileges('profiles.edit')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    if (body.loginUrl) validateProfileUrl(body.loginUrl, 'loginUrl');
    if (body.targetUrl) validateProfileUrl(body.targetUrl, 'targetUrl');
    if (body.proxy) validateProxyUrl(body.proxy);
    try {
      const profile = await this.profiles.update(id, body);
      this.activity.recordActivity({
        actorType: 'USER',
        actorId: req.user?.sub,
        action: 'profile.update',
        target: profile.name,
      });
      this.schedulerService?.rescheduleAll?.();
      return profile;
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Profile name already exists');
      }
      throw err;
    }
  }

  @Delete(':id')
  @Privileges('profiles.delete')
  async remove(@Req() req: any, @Param('id') id: string) {
    const profile = await this.profiles.findOne(id).catch(() => null);
    if (!profile) throw new NotFoundException('Profile not found');

    await this.scraper.closeContext(id);
    await this.profiles.remove(id);
    this.activity.recordActivity({
      actorType: 'USER',
      actorId: req.user?.sub,
      action: 'profile.delete',
      target: profile.name,
    });
    this.schedulerService?.rescheduleAll?.();
    return { ok: true };
  }

  @Post(':id/login')
  @Privileges('profiles.login')
  async startLogin(@Req() req: any, @Param('id') id: string) {
    const profile = await this.profiles.findOne(id).catch(() => null);
    if (!profile) throw new NotFoundException('Profile not found');

    const result = await this.scraper.startLogin(profile);

    if (!result.alreadyOpen) {
      this.logs.logEvent({
        type: 'login',
        profileId: id,
        message: `Login window opened for ${profile.name}`,
      });
      this.activity.recordActivity({
        actorType: 'USER',
        actorId: req.user?.sub,
        action: 'profile.login_open',
        target: profile.name,
      });
    }

    return { ok: true, alreadyOpen: result.alreadyOpen };
  }

  @Post(':id/login/finish')
  @Privileges('profiles.login')
  async finishLogin(@Req() req: any, @Param('id') id: string) {
    if (!this.scraper.hasLoginSession(id)) {
      throw new NotFoundException('No active login session');
    }

    const profile = await this.profiles.findOne(id).catch(() => null);
    if (!profile) throw new NotFoundException('Profile not found');

    await this.scraper.finishLogin(profile);
    await this.profiles.update(id, {
      status: 'LOGGED_IN' as any,
      lastLoginAt: new Date(),
    });

    this.logs.logEvent({
      type: 'login',
      profileId: id,
      message: `Login session saved for ${profile.name}`,
    });
    this.activity.recordActivity({
      actorType: 'USER',
      actorId: req.user?.sub,
      action: 'profile.login_save',
      target: profile.name,
    });

    return { ok: true };
  }

  @Post(':id/login/cancel')
  @Privileges('profiles.login')
  async cancelLogin(@Param('id') id: string) {
    await this.scraper.cancelLogin(id);
    return { ok: true };
  }

  @Post(':id/fetch')
  @Privileges('profiles.fetch')
  async fetchData(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { period?: 'today' | 'yesterday' },
  ) {
    const profile = await this.profiles.findOne(id).catch(() => null);
    if (!profile) throw new NotFoundException('Profile not found');

    const period = body?.period === 'yesterday' ? 'yesterday' : 'today';
    const previousStatus = (profile as any).status;

    this.logs.logEvent({
      type: 'manual',
      profileId: id,
      message: `Manual fetch started for ${profile.name} (${period})`,
    });

    let result: any;
    if (period === 'yesterday') {
      result = await this.scrapes.fetchYesterday(profile);
    } else {
      result = await this.scrapes.runAndSave(profile, period);
    }

    this.activity.recordActivity({
      actorType: 'USER',
      actorId: req.user?.sub,
      action: 'fetch',
      target: profile.name,
      details: period === 'yesterday'
        ? `yesterday${result.cached ? ' (archive)' : ''}`
        : period,
    });

    if (this.telegramService && result.loggedIn === false) {
      if (result.accessDenied && previousStatus !== 'ACCESS_DENIED') {
        this.telegramService.sendAccessDeniedAlert?.(profile, 'manual fetch').catch(() => {});
      } else if (!result.accessDenied && previousStatus !== 'LOGGED_OUT') {
        this.telegramService.sendSessionAlert?.(profile, 'manual fetch').catch(() => {});
      }
    }

    if (result.scrape) {
      const currency = currencyForPlatform(profile.kind);
      const rates = await getExchangeRates();
      if (rates) {
        const dep = Number(result.scrape.totalDepositAmount) || 0;
        const wth = Number(result.scrape.totalWithdrawalAmount) || 0;
        result.conversions = {
          totalDepositAmount: convertedLabels(dep, currency, rates),
          totalWithdrawalAmount: convertedLabels(wth, currency, rates),
        };
      }
      result.fetchedAt = result.scrape.updatedAt || result.scrape.createdAt || new Date().toISOString();

      if (period === 'today') {
        const yScrape = await this.scrapes.getYesterday(id);
        if (yScrape) {
          result.yesterday = {
            totalDepositAmount: yScrape.totalDepositAmount,
            totalWithdrawalAmount: yScrape.totalWithdrawalAmount,
            newRegistrationCount: yScrape.newRegistrationCount,
            newDepositCount: yScrape.newDepositCount,
            totalDepositCount: yScrape.totalDepositCount,
            totalWithdrawalCount: yScrape.totalWithdrawalCount,
          };
        }
      }
    }

    return result;
  }
}

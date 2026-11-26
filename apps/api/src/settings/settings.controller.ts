import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrivilegesGuard, Privileges } from '../auth/privileges.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard, PrivilegesGuard)
@ApiBearerAuth()
export class SettingsController {
  private telegramService: any = null;
  private schedulerService: any = null;
  private dailyCaptureService: any = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  setTelegramService(service: any) { this.telegramService = service; }
  setSchedulerService(service: any) { this.schedulerService = service; }
  setDailyCaptureService(service: any) { this.dailyCaptureService = service; }

  @Get('scheduler')
  @Privileges('settings.view')
  async getScheduler() {
    const settings = await this.settings.getSchedulerSettings();
    const runtime = this.schedulerService?.getSnapshot?.() ?? null;
    return { settings, runtime };
  }

  @Patch('scheduler')
  @Privileges('settings.edit')
  async updateScheduler(@Body() body: any) {
    const result = await this.settings.updateSchedulerSettings(body);
    if (this.schedulerService) {
      const merged = await this.settings.getSchedulerSettings();
      await this.schedulerService.applySettings(merged);
    }
    if (body.platforms && this.dailyCaptureService) {
      await this.dailyCaptureService.rescheduleDailyCapture();
    }
    return result;
  }

  @Get('scheduler/platforms')
  @Privileges('settings.view')
  async getPlatforms() {
    const s = await this.settings.getSchedulerSettings();
    return s.platforms ?? {};
  }

  @Patch('scheduler/platforms/:kind')
  @Privileges('settings.edit')
  async updatePlatform(
    @Param('kind') kind: string,
    @Body() body: { dayCutover?: string; todayMissing?: string },
  ) {
    const s = await this.settings.getSchedulerSettings();
    const platforms = s.platforms ?? {};
    const key = kind.toLowerCase();
    platforms[key] = { ...(platforms[key] || {}), ...body };
    return this.settings.updateSchedulerSettings({ platforms });
  }

  @Get('telegram')
  @Privileges('settings.view')
  async getTelegram() {
    const settings = await this.settings.getTelegramSettings();
    const bot = this.telegramService?.getBotInfo?.() ?? null;
    const tokenPreview = this.telegramService?.getToken?.() ?? '';
    return { ...settings, bot, tokenPreview };
  }

  @Post('telegram/bot-token')
  @Privileges('settings.edit')
  async updateBotToken(@Body() body: { token: string }) {
    if (!this.telegramService) {
      return { ok: false, error: 'Telegram service not available' };
    }
    return this.telegramService.updateBotToken(body.token || '');
  }

  @Patch('telegram')
  @Privileges('settings.edit')
  async updateTelegram(@Body() body: any) {
    if (body.sendImage === false && body.sendText === false) {
      throw new BadRequestException(
        'At least one of sendImage or sendText must be enabled',
      );
    }
    const current = await this.settings.getTelegramSettings();
    const sendImage = body.sendImage ?? current.sendImage;
    const sendText = body.sendText ?? current.sendText;
    if (!sendImage && !sendText) {
      throw new BadRequestException(
        'At least one of sendImage or sendText must be enabled',
      );
    }
    return this.settings.updateTelegramSettings(body);
  }

  @Post('telegram/chat-ids')
  @Privileges('settings.edit')
  addChatId(@Body() body: { chatId?: string; value?: string }) {
    const chatId = body.chatId || body.value;
    if (!chatId) return { error: 'chatId is required' };
    return this.settings.addTelegramChatId(chatId);
  }

  @Delete('telegram/chat-ids/:chatId')
  @Privileges('settings.edit')
  removeChatId(@Param('chatId') chatId: string) {
    return this.settings.removeTelegramChatId(chatId);
  }

  @Post('telegram/alert-chats')
  @Privileges('settings.edit')
  addAlertChat(@Body() body: { chatId?: string; value?: string }) {
    const chatId = body.chatId || body.value;
    if (!chatId) return { error: 'chatId is required' };
    return this.settings.addAlertChatId(chatId);
  }

  @Delete('telegram/alert-chats/:chatId')
  @Privileges('settings.edit')
  removeAlertChat(@Param('chatId') chatId: string) {
    return this.settings.removeAlertChatId(chatId);
  }

  @Post('telegram/usernames')
  @Privileges('settings.edit')
  addUsername(@Body() body: { username?: string; value?: string }) {
    const username = body.username || body.value;
    if (!username) return { error: 'username is required' };
    return this.settings.addUsername(username);
  }

  @Delete('telegram/usernames/:username')
  @Privileges('settings.edit')
  removeUsername(@Param('username') username: string) {
    return this.settings.removeUsername(username);
  }

  @Post('telegram/test-alert')
  @Privileges('settings.edit')
  async testAlert() {
    if (!this.telegramService) {
      return { ok: false, error: 'Telegram service not available' };
    }
    return this.telegramService.sendTestAlert();
  }
}

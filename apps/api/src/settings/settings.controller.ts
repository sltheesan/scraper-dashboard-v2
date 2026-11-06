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
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
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
  async getScheduler() {
    const settings = await this.settings.getSchedulerSettings();
    const runtime = this.schedulerService?.getSnapshot?.() ?? null;
    return { settings, runtime };
  }

  @Patch('scheduler')
  @Roles('ADMIN')
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
  async getPlatforms() {
    const s = await this.settings.getSchedulerSettings();
    return s.platforms ?? {};
  }

  @Patch('scheduler/platforms/:kind')
  @Roles('ADMIN')
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
  async getTelegram() {
    const settings = await this.settings.getTelegramSettings();
    const bot = this.telegramService?.getBotInfo?.() ?? null;
    const tokenConfigured = !!this.config.get('TELEGRAM_BOT_TOKEN', '');
    return { ...settings, bot, tokenConfigured };
  }

  @Patch('telegram')
  @Roles('ADMIN')
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
  @Roles('ADMIN')
  addChatId(@Body() body: { chatId?: string; value?: string }) {
    const chatId = body.chatId || body.value;
    if (!chatId) return { error: 'chatId is required' };
    return this.settings.addTelegramChatId(chatId);
  }

  @Delete('telegram/chat-ids/:chatId')
  @Roles('ADMIN')
  removeChatId(@Param('chatId') chatId: string) {
    return this.settings.removeTelegramChatId(chatId);
  }

  @Post('telegram/alert-chats')
  @Roles('ADMIN')
  addAlertChat(@Body() body: { chatId?: string; value?: string }) {
    const chatId = body.chatId || body.value;
    if (!chatId) return { error: 'chatId is required' };
    return this.settings.addAlertChatId(chatId);
  }

  @Delete('telegram/alert-chats/:chatId')
  @Roles('ADMIN')
  removeAlertChat(@Param('chatId') chatId: string) {
    return this.settings.removeAlertChatId(chatId);
  }

  @Post('telegram/usernames')
  @Roles('ADMIN')
  addUsername(@Body() body: { username?: string; value?: string }) {
    const username = body.username || body.value;
    if (!username) return { error: 'username is required' };
    return this.settings.addUsername(username);
  }

  @Delete('telegram/usernames/:username')
  @Roles('ADMIN')
  removeUsername(@Param('username') username: string) {
    return this.settings.removeUsername(username);
  }

  @Post('telegram/test-alert')
  @Roles('ADMIN')
  async testAlert() {
    if (!this.telegramService) {
      return { ok: false, error: 'Telegram service not available' };
    }
    return this.telegramService.sendTestAlert();
  }
}

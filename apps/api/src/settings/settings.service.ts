import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SCHEDULER_DEFAULTS = {
  fetch: { enabled: false, intervalMs: 300000 },
  refresh: { enabled: false, intervalMs: 300000 },
  platforms: {
    cgaming: { dayCutover: '11:00', todayMissing: 'calm' as const },
    zoomwlb: { dayCutover: '11:00', todayMissing: 'calm' as const },
  },
};

export interface PlatformConfig {
  dayCutover: string;
  todayMissing: 'calm' | 'fallback';
}

const TELEGRAM_DEFAULTS = {
  restricted: true,
  allowedChatIds: [] as string[],
  allowedUsernames: [] as string[],
  sendImage: true,
  sendText: true,
  alertChatIds: [] as string[],
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSetting(key: string) {
    return this.prisma.setting.findUnique({ where: { key } });
  }

  async upsertSetting(key: string, value: any) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getSchedulerSettings() {
    const row = await this.getSetting('scheduler');
    return { ...SCHEDULER_DEFAULTS, ...(row?.value as any) };
  }

  async updateSchedulerSettings(data: any) {
    const current = await this.getSchedulerSettings();
    const merged = { ...current, ...data };
    if (data.platforms) {
      merged.platforms = { ...current.platforms, ...data.platforms };
    }
    return this.upsertSetting('scheduler', merged);
  }

  async getPlatformConfig(kind: string): Promise<PlatformConfig> {
    const settings = await this.getSchedulerSettings();
    const key = kind.toLowerCase();
    const platform = settings.platforms?.[key];
    return {
      dayCutover: platform?.dayCutover || '11:00',
      todayMissing: platform?.todayMissing || 'calm',
    };
  }

  async getTelegramSettings() {
    const row = await this.getSetting('telegram');
    return { ...TELEGRAM_DEFAULTS, ...(row?.value as any) };
  }

  async updateTelegramSettings(data: any) {
    const current = await this.getTelegramSettings();
    const merged = { ...current, ...data };
    return this.upsertSetting('telegram', merged);
  }

  async addTelegramChatId(chatId: string) {
    const settings = await this.getTelegramSettings();
    if (!settings.allowedChatIds.includes(chatId)) {
      settings.allowedChatIds.push(chatId);
    }
    return this.upsertSetting('telegram', settings);
  }

  async removeTelegramChatId(chatId: string) {
    const settings = await this.getTelegramSettings();
    settings.allowedChatIds = settings.allowedChatIds.filter(
      (id: string) => id !== chatId,
    );
    return this.upsertSetting('telegram', settings);
  }

  async addAlertChatId(chatId: string) {
    const settings = await this.getTelegramSettings();
    if (!settings.alertChatIds.includes(chatId)) {
      settings.alertChatIds.push(chatId);
    }
    return this.upsertSetting('telegram', settings);
  }

  async removeAlertChatId(chatId: string) {
    const settings = await this.getTelegramSettings();
    settings.alertChatIds = settings.alertChatIds.filter(
      (id: string) => id !== chatId,
    );
    return this.upsertSetting('telegram', settings);
  }

  async addUsername(username: string) {
    const settings = await this.getTelegramSettings();
    const normalized = username.replace(/^@/, '').toLowerCase();
    if (!settings.allowedUsernames.includes(normalized)) {
      settings.allowedUsernames.push(normalized);
    }
    return this.upsertSetting('telegram', settings);
  }

  async removeUsername(username: string) {
    const settings = await this.getTelegramSettings();
    const normalized = username.replace(/^@/, '').toLowerCase();
    settings.allowedUsernames = settings.allowedUsernames.filter(
      (u: string) => u !== normalized,
    );
    return this.upsertSetting('telegram', settings);
  }
}

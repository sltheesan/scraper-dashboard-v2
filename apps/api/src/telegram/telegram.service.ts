import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { COMMON_FIELDS, COMMON_LABELS } from '../scraper/parsers/common';
import { formatICT, formatICTDate } from '../common/business-day';
import { renderProfileCard, closeRenderer } from './image-render';

export interface TelegramSettings {
  restricted: boolean;
  allowedChatIds: string[];
  allowedUsernames: string[];
  sendImage: boolean;
  sendText: boolean;
  alertChatIds: string[];
}

const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  restricted: true,
  allowedChatIds: [],
  allowedUsernames: [],
  sendImage: true,
  sendText: true,
  alertChatIds: [],
};

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c,
  );
}

function fmtNum(v: unknown): string {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toLocaleString('en-US') : esc(String(v));
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function tgActor(chatId: number, username?: string): string {
  return username ? `@${username}` : String(chatId);
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private token: string;
  private baseUrl: string;
  private polling = false;
  private offset = 0;
  private pollController: AbortController | null = null;
  private me: { username: string; id: number } | null = null;
  private settings: TelegramSettings = { ...DEFAULT_TELEGRAM_SETTINGS };
  private scrapesService: any = null;
  private scraperService: any = null;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
  ) {
    this.token = this.config.get('TELEGRAM_BOT_TOKEN', '');
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  setScrapesService(service: any) {
    this.scrapesService = service;
  }

  setScraperService(service: any) {
    this.scraperService = service;
  }

  async onModuleInit() {
    await this.loadSettings();
    if (this.token) {
      await this.startBot();
    } else {
      this.logger.warn('No TELEGRAM_BOT_TOKEN configured, bot disabled');
    }
  }

  onModuleDestroy() {
    this.stop();
    closeRenderer().catch(() => {});
  }

  async loadSettings() {
    const row = await this.prisma.setting.findUnique({
      where: { key: 'telegram' },
    });
    if (row) {
      this.settings = row.value as unknown as TelegramSettings;
    }
  }

  async saveSettings(next: Partial<TelegramSettings>) {
    this.settings = { ...this.settings, ...next };
    await this.prisma.setting.upsert({
      where: { key: 'telegram' },
      create: { key: 'telegram', value: this.settings as any },
      update: { value: this.settings as any },
    });
  }

  getSettings(): TelegramSettings {
    return { ...this.settings };
  }

  getBotInfo() {
    return this.me ? { username: this.me.username, id: this.me.id } : null;
  }

  // --- Telegram API helpers ---

  private async call(method: string, body?: any, timeoutMs = 15000): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    options?: { parse_mode?: string; reply_markup?: any },
  ) {
    return this.call('sendMessage', { chat_id: chatId, text, ...options });
  }

  async sendPhoto(
    chatId: string | number,
    photo: Buffer,
    options?: { caption?: string; reply_markup?: any },
  ) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (options?.caption) {
      form.append('caption', options.caption);
      form.append('parse_mode', 'HTML');
    }
    if (options?.reply_markup) {
      form.append('reply_markup', JSON.stringify(options.reply_markup));
    }
    form.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'card.png');

    const res = await fetch(`${this.baseUrl}/sendPhoto`, { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'sendPhoto failed');
    return data.result;
  }

  // --- Bot lifecycle ---

  private async startBot() {
    if (this.polling) return;

    try {
      this.me = await this.call('getMe');
    } catch (err: any) {
      this.logger.error(`Bot not started — getMe failed: ${err.message}`);
      return;
    }

    // Skip backlog so a restart doesn't replay old taps
    try {
      const backlog = await this.call('getUpdates', { offset: -1, timeout: 0 });
      if (Array.isArray(backlog) && backlog.length) {
        this.offset = backlog[backlog.length - 1].update_id + 1;
      }
    } catch { /* ignore */ }

    this.polling = true;
    this.logger.log(`Bot started as @${this.me!.username}`);
    this.logs.logEvent({ type: 'telegram', message: `Bot online as @${this.me!.username}` });
    this.poll();
  }

  start() {
    this.startBot().catch((err) =>
      this.logger.error(`Bot start failed: ${err.message}`),
    );
  }

  stop() {
    this.polling = false;
    if (this.pollController) {
      try { this.pollController.abort(); } catch { /* ignore */ }
      this.pollController = null;
    }
    this.logger.log('Bot stopped');
  }

  // --- Polling ---

  private async poll() {
    while (this.polling) {
      const ctrl = new AbortController();
      this.pollController = ctrl;
      const timer = setTimeout(() => ctrl.abort(), 40000);

      try {
        const res = await fetch(`${this.baseUrl}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.offset,
            timeout: 30,
            allowed_updates: ['message', 'callback_query'],
          }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (data.ok && data.result) {
          for (const u of data.result) {
            this.offset = u.update_id + 1;
            this.handleUpdate(u).catch((e) =>
              this.logger.error(`Update handler error: ${e.message}`),
            );
          }
        }
      } catch (err: any) {
        clearTimeout(timer);
        if (!this.polling) break;
        if (err.name !== 'AbortError') {
          this.logger.error(`Polling error: ${err.message}`);
          await new Promise((r) => setTimeout(r, 3000));
        }
        continue;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // --- Update handling ---

  private async handleUpdate(u: any) {
    if (u.message) return this.handleMessage(u.message);
    if (u.callback_query) return this.handleCallback(u.callback_query);
  }

  private isAllowed(chatId: number, username?: string): boolean {
    if (!this.settings.restricted) return true;
    if (this.settings.allowedChatIds.includes(String(chatId))) return true;
    if (username) {
      const norm = username.toLowerCase().replace(/^@/, '');
      if (this.settings.allowedUsernames.some((u) => u.toLowerCase().replace(/^@/, '') === norm)) {
        return true;
      }
    }
    return false;
  }

  private async handleMessage(msg: any) {
    const chatId = msg.chat?.id;
    if (chatId == null) return;
    const username = msg.from?.username;

    if (!this.isAllowed(chatId, username)) {
      this.recordActivity('telegram', tgActor(chatId, username), 'access_denied', '', msg.text ? `msg: ${msg.text.slice(0, 40)}` : '');
      const handleLine = username ? `\nYour username: <code>@${esc(username)}</code>` : '';
      await this.sendMessage(chatId,
        `⛔ You are not authorized to use this bot.\n\n` +
        `Your chat ID is: <code>${chatId}</code>${handleLine}\n` +
        `Ask the admin to add it in the dashboard → <b>Telegram</b>.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    await this.sendProfileList(chatId);
  }

  private async handleCallback(cq: any) {
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const data = cq.data || '';

    if (!this.isAllowed(chatId, cq.from?.username)) {
      await this.call('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Not authorized',
        show_alert: true,
      }).catch(() => {});
      return;
    }

    if (data === 'list') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.sendProfileList(chatId, messageId);
      return;
    }

    if (data.startsWith('f:')) {
      await this.call('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Fetching…',
      }).catch(() => {});
      await this.doFetch(chatId, data.slice(2), 'today', cq.from?.username);
      return;
    }

    if (data.startsWith('y:')) {
      await this.call('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Fetching yesterday…',
      }).catch(() => {});
      await this.doFetch(chatId, data.slice(2), 'yesterday', cq.from?.username);
      return;
    }

    await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
  }

  // --- Profile list ---

  private async sendProfileList(chatId: number, messageId?: number) {
    const profiles = await this.prisma.profile.findMany({
      orderBy: { name: 'asc' },
    });

    if (!profiles.length) {
      await this.sendMessage(chatId, 'No profiles in the system yet.');
      return;
    }

    const buttons = profiles.map((p) => ({
      text: p.name,
      callback_data: `f:${p.id}`,
    }));
    const reply_markup = { inline_keyboard: chunk(buttons, 2) };
    const text = `📋 <b>Select a profile to fetch</b>  (${profiles.length})`;
    const payload = { chat_id: chatId, text, parse_mode: 'HTML', reply_markup };

    if (messageId) {
      await this.call('editMessageText', { ...payload, message_id: messageId }).catch(() =>
        this.call('sendMessage', payload),
      );
    } else {
      await this.call('sendMessage', payload);
    }
  }

  // --- Result formatting ---

  private formatResult(
    profile: { name: string; kind: string },
    parsed: any,
    when: string,
  ): string {
    if (!parsed) {
      return `ℹ️ <b>${esc(profile.name)}</b>\nLogged in, but no data could be parsed from the page.`;
    }
    const lines = COMMON_FIELDS.map(
      (k) => `• ${COMMON_LABELS[k]}: <b>${fmtNum(parsed.data?.[k])}</b>`,
    );
    const header = `📊 <b>${esc(profile.name)}</b> <i>(${esc(profile.kind)})</i>\n🕒 ${esc(when)}`;
    return `${header}\n\n${lines.join('\n')}`;
  }

  private resultKeyboard(profileId: string) {
    return {
      inline_keyboard: [
        [
          { text: '🔄 Today', callback_data: `f:${profileId}` },
          { text: '📅 Yesterday', callback_data: `y:${profileId}` },
        ],
        [{ text: '‹ Back to list', callback_data: 'list' }],
      ],
    };
  }

  private async finishText(
    chatId: number,
    messageId: number | null,
    text: string,
    reply_markup?: any,
  ) {
    const payload: any = { chat_id: chatId, text, parse_mode: 'HTML', reply_markup };
    if (messageId) {
      await this.call('editMessageText', { ...payload, message_id: messageId }).catch(() =>
        this.call('sendMessage', payload),
      );
    } else {
      await this.call('sendMessage', payload);
    }
  }

  // --- Fetch on tap ---

  private async doFetch(
    chatId: number,
    profileId: string,
    period: 'today' | 'yesterday',
    username?: string,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      await this.sendMessage(chatId, 'Profile not found.');
      return;
    }

    if (this.inFlight.has(profile.id)) {
      await this.sendMessage(chatId, `⏳ ${esc(profile.name)} is already being fetched…`, { parse_mode: 'HTML' });
      return;
    }
    this.inFlight.add(profile.id);

    this.recordActivity('telegram', tgActor(chatId, username), 'fetch', profile.name, period);

    const periodLabel = period === 'yesterday' ? "yesterday's" : "today's";

    let statusId: number | null = null;
    try {
      const m = await this.sendMessage(chatId,
        `⏳ Fetching ${periodLabel} data for <b>${esc(profile.name)}</b>…`,
        { parse_mode: 'HTML' },
      );
      statusId = m?.message_id ?? null;
    } catch { /* ignore */ }

    this.logs.logEvent({
      type: 'telegram',
      profileId: profile.id,
      message: `Telegram fetch started (${period})`,
    });

    const kb = this.resultKeyboard(profile.id);

    try {
      let result: any;
      let parsed: any = null;
      let cached = false;

      if (!this.scrapesService) {
        await this.finishText(chatId, statusId, `❌ Scrapes service not available.`);
        return;
      }

      if (period === 'yesterday') {
        const yResult = await this.scrapesService.fetchYesterday(profile);
        if (yResult.cached) {
          cached = true;
          result = { loggedIn: true };
          parsed = {
            data: {
              newRegistrationCount: yResult.scrape?.newRegistrationCount ?? null,
              newDepositCount: yResult.scrape?.newDepositCount ?? null,
              totalDepositCount: yResult.scrape?.totalDepositCount ?? null,
              totalDepositAmount: yResult.scrape?.totalDepositAmount != null ? Number(yResult.scrape.totalDepositAmount) : null,
              totalWithdrawalCount: yResult.scrape?.totalWithdrawalCount ?? null,
              totalWithdrawalAmount: yResult.scrape?.totalWithdrawalAmount != null ? Number(yResult.scrape.totalWithdrawalAmount) : null,
            },
            reportDate: yResult.scrape?.reportDate,
            reportDateString: yResult.scrape?.reportDateString,
          };
        } else {
          result = yResult;
          parsed = yResult.scrape ? {
            data: {
              newRegistrationCount: yResult.scrape?.newRegistrationCount ?? null,
              newDepositCount: yResult.scrape?.newDepositCount ?? null,
              totalDepositCount: yResult.scrape?.totalDepositCount ?? null,
              totalDepositAmount: yResult.scrape?.totalDepositAmount != null ? Number(yResult.scrape.totalDepositAmount) : null,
              totalWithdrawalCount: yResult.scrape?.totalWithdrawalCount ?? null,
              totalWithdrawalAmount: yResult.scrape?.totalWithdrawalAmount != null ? Number(yResult.scrape.totalWithdrawalAmount) : null,
            },
            reportDate: yResult.scrape?.reportDate,
            reportDateString: yResult.scrape?.reportDateString,
          } : null;
        }
      } else {
        const tResult = await this.scrapesService.runAndSave(profile, 'today');
        result = tResult;
        if (tResult.parsed) {
          parsed = tResult.parsed;
        } else if (tResult.scrape) {
          parsed = {
            data: {
              newRegistrationCount: tResult.scrape?.newRegistrationCount ?? null,
              newDepositCount: tResult.scrape?.newDepositCount ?? null,
              totalDepositCount: tResult.scrape?.totalDepositCount ?? null,
              totalDepositAmount: tResult.scrape?.totalDepositAmount != null ? Number(tResult.scrape.totalDepositAmount) : null,
              totalWithdrawalCount: tResult.scrape?.totalWithdrawalCount ?? null,
              totalWithdrawalAmount: tResult.scrape?.totalWithdrawalAmount != null ? Number(tResult.scrape.totalWithdrawalAmount) : null,
            },
            reportDate: tResult.scrape?.reportDate,
            reportDateString: tResult.scrape?.reportDateString,
          };
        }
      }

      if (result && result.loggedIn === false) {
        const prevStatus = profile.status;

        if (result.accessDenied) {
          await this.prisma.profile.update({
            where: { id: profile.id },
            data: { status: 'ACCESS_DENIED' },
          });
          this.logs.logEvent({
            type: 'telegram',
            profileId: profile.id,
            message: 'Telegram fetch: access denied',
            level: 'warn',
          });
          if (prevStatus !== 'ACCESS_DENIED') {
            this.sendAccessDeniedAlert(profile, 'Telegram fetch');
          }
          await this.finishText(chatId, statusId,
            `🚫 <b>${esc(profile.name)}</b>\nAccess denied — re-login this profile, or check its account permission / IP allowlist.`,
            kb,
          );
          return;
        }

        await this.prisma.profile.update({
          where: { id: profile.id },
          data: { status: 'LOGGED_OUT' },
        });
        this.logs.logEvent({
          type: 'telegram',
          profileId: profile.id,
          message: 'Telegram fetch: session expired',
          level: 'warn',
        });
        if (prevStatus !== 'LOGGED_OUT') {
          this.sendSessionAlert(profile, 'Telegram fetch');
        }
        await this.finishText(chatId, statusId,
          `⚠️ <b>${esc(profile.name)}</b>\nSession expired — open the dashboard and click <b>Login</b>.`,
          kb,
        );
        return;
      }

      if (!cached && result?.loggedIn !== false) {
        await this.prisma.profile.update({
          where: { id: profile.id },
          data: { status: 'LOGGED_IN' },
        }).catch(() => {});
      }

      let when: string;
      if (period === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        when = `Yesterday · ${formatICTDate(y)}`;
      } else {
        when = formatICT();
      }

      if (parsed) {
        await this.loadSettings();
        const text = this.formatResult(profile, parsed, when);

        let png: Buffer | null = null;
        if (this.settings.sendImage) {
          png = await renderProfileCard(profile, parsed, when);
        }

        if (png) {
          await this.sendPhoto(chatId, png, {
            caption: this.settings.sendText ? text : undefined,
            reply_markup: kb,
          });
          if (statusId) {
            await this.call('deleteMessage', { chat_id: chatId, message_id: statusId }).catch(() => {});
          }
          this.logs.logEvent({
            type: 'telegram',
            profileId: profile.id,
            message: `Telegram fetch: ${this.settings.sendText ? 'image + text' : 'image'} sent`,
          });
          return;
        }

        await this.finishText(chatId, statusId, text, kb);
        this.logs.logEvent({
          type: 'telegram',
          profileId: profile.id,
          message: this.settings.sendImage
            ? 'Telegram fetch: image failed, sent text'
            : 'Telegram fetch: text sent',
        });
        return;
      }

      await this.finishText(chatId, statusId, this.formatResult(profile, null, when), kb);
      this.logs.logEvent({
        type: 'telegram',
        profileId: profile.id,
        message: 'Telegram fetch: no values',
      });
    } catch (err: any) {
      this.logger.error(`Telegram fetch failed: ${err.message}`);
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { status: 'ERROR' },
      }).catch(() => {});
      this.logs.logEvent({
        type: 'error',
        profileId: profile.id,
        message: `Telegram fetch failed: ${err.message}`,
      });
      await this.finishText(chatId, statusId,
        `❌ <b>${esc(profile.name)}</b>\nFetch failed: ${esc(err.message)}`,
        kb,
      );
    } finally {
      this.inFlight.delete(profile.id);
    }
  }

  // --- Alerts ---

  async sendSessionAlert(profile: { name: string }, source: string) {
    try {
      if (!this.token) return;
      await this.loadSettings();
      if (!this.settings.alertChatIds.length) return;

      const text =
        `🚨 <b>Session expired</b>\n` +
        `Profile: <b>${esc(profile.name)}</b>\n` +
        `🕒 ${esc(formatICT())}` +
        (source ? `\nDetected by: ${esc(source)}` : '') +
        `\n\nOpen the dashboard and click <b>Login</b> to re-authenticate.`;

      const results = await Promise.all(
        this.settings.alertChatIds.map((chatId) =>
          this.sendMessage(chatId, text, { parse_mode: 'HTML' })
            .then(() => ({ chatId, ok: true }))
            .catch((err: any) => ({ chatId, ok: false, error: err.message })),
        ),
      );
      const sent = results.filter((r) => r.ok).length;
      this.logs.logEvent({
        type: 'alert',
        message: `Session-expired alert sent for ${profile.name}: ${sent}/${results.length} · ${source}`,
      });
    } catch (err: any) {
      this.logger.warn(`session alert failed: ${err.message}`);
    }
  }

  async sendAccessDeniedAlert(profile: { name: string }, source: string) {
    try {
      if (!this.token) return;
      await this.loadSettings();
      if (!this.settings.alertChatIds.length) return;

      const text =
        `🚫 <b>Access denied</b>\n` +
        `Profile: <b>${esc(profile.name)}</b>\n` +
        `🕒 ${esc(formatICT())}` +
        (source ? `\nDetected by: ${esc(source)}` : '') +
        `\n\nThe account was bounced to an Access-Denied page. Re-login this ` +
        `profile, or check its account permission / IP allowlist.`;

      const results = await Promise.all(
        this.settings.alertChatIds.map((chatId) =>
          this.sendMessage(chatId, text, { parse_mode: 'HTML' })
            .then(() => ({ chatId, ok: true }))
            .catch((err: any) => ({ chatId, ok: false, error: err.message })),
        ),
      );
      const sent = results.filter((r) => r.ok).length;
      this.logs.logEvent({
        type: 'alert',
        message: `Access-denied alert sent for ${profile.name}: ${sent}/${results.length} · ${source}`,
      });
    } catch (err: any) {
      this.logger.warn(`access-denied alert failed: ${err.message}`);
    }
  }

  async sendTestAlert() {
    if (!this.token) return { ok: false, error: 'Bot is not running.' };
    await this.loadSettings();
    if (!this.settings.alertChatIds.length) return { ok: false, error: 'No alert chat IDs are set.' };

    const text = `✅ <b>Test alert</b>\nSession-expired alerts are working.\n🕒 ${esc(formatICT())}`;
    const results = await Promise.all(
      this.settings.alertChatIds.map(async (chatId) => {
        try {
          await this.sendMessage(chatId, text, { parse_mode: 'HTML' });
          return { chatId, ok: true };
        } catch (err: any) {
          return { chatId, ok: false, error: err.message };
        }
      }),
    );
    const sent = results.filter((r) => r.ok).length;
    return { ok: sent > 0, sent, failed: results.length - sent, results };
  }

  // --- Activity logging (fire-and-forget) ---

  private recordActivity(
    actorType: string,
    actor: string,
    action: string,
    target: string,
    details: string,
  ) {
    const fullDetails = actor ? (details ? `${actor}: ${details}` : actor) : details;
    this.prisma.activityLog.create({
      data: {
        actorType: actorType.toUpperCase() as any,
        action,
        target,
        details: fullDetails,
      },
    }).catch(() => {});
  }
}

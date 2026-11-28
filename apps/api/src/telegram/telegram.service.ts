import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { COMMON_FIELDS, COMMON_LABELS } from '../scraper/parsers/common';
import { formatICT, formatICTDate } from '../common/business-day';
import {
  renderProfileCard,
  renderSummaryCard,
  renderRankingsCard,
  renderStatusCard,
  closeRenderer,
  type SummaryPlatform,
  type RankingEntry,
  type StatusGroup,
} from './image-render';
import { currencyForPlatform, getExchangeRates, convertedLabels, CurrencyInfo } from '../common/currency';

export interface TelegramFeatures {
  summary: boolean;
  rankings: boolean;
  statusCheck: boolean;
  pinFavorites: boolean;
  scheduledPush: boolean;
  thresholdAlerts: boolean;
}

export interface TelegramSettings {
  restricted: boolean;
  allowedChatIds: string[];
  allowedUsernames: string[];
  sendImage: boolean;
  sendText: boolean;
  summaryText: boolean;
  summaryImage: boolean;
  rankingsText: boolean;
  rankingsImage: boolean;
  statusText: boolean;
  statusImage: boolean;
  alertChatIds: string[];
  features: TelegramFeatures;
  pinnedProfiles: string[];
  scheduledPush: { time: string; lastSentDate: string };
  thresholdAlerts: { depositDropPercent: number; negativeNetFlow: boolean };
}

const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  restricted: true,
  allowedChatIds: [],
  allowedUsernames: [],
  sendImage: true,
  sendText: true,
  summaryText: true,
  summaryImage: false,
  rankingsText: true,
  rankingsImage: false,
  statusText: true,
  statusImage: false,
  alertChatIds: [],
  features: {
    summary: true,
    rankings: true,
    statusCheck: true,
    pinFavorites: true,
    scheduledPush: false,
    thresholdAlerts: false,
  },
  pinnedProfiles: [],
  scheduledPush: { time: '11:30', lastSentDate: '' },
  thresholdAlerts: { depositDropPercent: 30, negativeNetFlow: true },
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
  private settingsService: any = null;
  private readonly inFlight = new Set<string>();
  private pushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
  ) {
    this.token = this.config.get('TELEGRAM_BOT_TOKEN', '');
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  private applyToken(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  setScrapesService(service: any) {
    this.scrapesService = service;
  }

  setScraperService(service: any) {
    this.scraperService = service;
  }

  setSettingsService(service: any) {
    this.settingsService = service;
  }

  async onModuleInit() {
    await this.loadSettings();
    const dbToken = await this.loadTokenFromDb();
    if (dbToken) {
      this.applyToken(dbToken);
    }
    if (this.token) {
      await this.startBot();
    } else {
      this.logger.warn('No TELEGRAM_BOT_TOKEN configured, bot disabled');
    }
    this.startPushTimer();
  }

  private async loadTokenFromDb(): Promise<string | null> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: 'telegram' } });
      const val = row?.value as any;
      return val?.botToken || null;
    } catch {
      return null;
    }
  }

  async updateBotToken(newToken: string): Promise<{ ok: boolean; username?: string; error?: string }> {
    this.stop();
    this.me = null;
    this.applyToken(newToken);

    const current = await this.prisma.setting.findUnique({ where: { key: 'telegram' } });
    const merged = { ...(current?.value as any || {}), botToken: newToken };
    await this.prisma.setting.upsert({
      where: { key: 'telegram' },
      create: { key: 'telegram', value: merged },
      update: { value: merged },
    });

    if (!newToken) {
      this.logger.log('Bot token cleared, bot disabled');
      return { ok: true };
    }

    try {
      await this.startBot();
      const bot = this.getBotInfo();
      return { ok: true, username: bot?.username };
    } catch (err: any) {
      this.logger.error(`Bot restart failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  getToken(): string {
    return this.token ? this.token.slice(0, 6) + '...' + this.token.slice(-4) : '';
  }

  onModuleDestroy() {
    this.stop();
    if (this.pushTimer) { clearInterval(this.pushTimer); this.pushTimer = null; }
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

    await this.sendMainMenu(chatId);
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

    if (data === 'menu') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.sendMainMenu(chatId, messageId);
      return;
    }

    if (data === 'list') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.sendProfileList(chatId, messageId);
      return;
    }

    if (data === 'summary') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.sendSummaryMenu(chatId, messageId);
      return;
    }

    if (data === 'summary:today') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Loading today summary…' }).catch(() => {});
      await this.doSummary(chatId, 'today', messageId);
      return;
    }

    if (data === 'summary:yesterday') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Loading yesterday summary…' }).catch(() => {});
      await this.doSummary(chatId, 'yesterday', messageId);
      return;
    }

    if (data === 'rankings') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.sendRankingsMenu(chatId, messageId);
      return;
    }

    if (data === 'rankings:today') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Loading today rankings…' }).catch(() => {});
      await this.doRankings(chatId, 'today', messageId);
      return;
    }

    if (data === 'rankings:yesterday') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Loading yesterday rankings…' }).catch(() => {});
      await this.doRankings(chatId, 'yesterday', messageId);
      return;
    }

    if (data === 'status') {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Loading status…' }).catch(() => {});
      await this.doStatus(chatId, messageId);
      return;
    }

    if (data.startsWith('pin:')) {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.doTogglePin(chatId, data.slice(4));
      return;
    }

    if (data.startsWith('unpin:')) {
      await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await this.doTogglePin(chatId, data.slice(6));
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

    if (data.startsWith('b:')) {
      await this.call('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Fetching both…',
      }).catch(() => {});
      await this.doBothFetch(chatId, data.slice(2), cq.from?.username);
      return;
    }

    await this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
  }

  // --- Main menu ---

  private async sendMainMenu(chatId: number, messageId?: number) {
    await this.loadSettings();
    const s = this.settings;

    const row1 = [{ text: '📋 Profiles', callback_data: 'list' }];
    if (s.summaryText || s.summaryImage) row1.push({ text: '📊 Summary', callback_data: 'summary' });

    const row2: { text: string; callback_data: string }[] = [];
    if (s.rankingsText || s.rankingsImage) row2.push({ text: '🏆 Rankings', callback_data: 'rankings' });
    if (s.statusText || s.statusImage) row2.push({ text: '🔍 Status', callback_data: 'status' });

    const rows = [row1];
    if (row2.length) rows.push(row2);

    const text = '📋 <b>Scraper Dashboard</b>\nChoose an option:';
    const payload: any = { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } };

    if (messageId) {
      await this.call('editMessageText', { ...payload, message_id: messageId }).catch(() =>
        this.call('sendMessage', payload),
      );
    } else {
      await this.call('sendMessage', payload);
    }
  }

  // --- Profile list ---

  private async sendProfileList(chatId: number, messageId?: number) {
    await this.loadSettings();
    const profiles = await this.prisma.profile.findMany({
      orderBy: { name: 'asc' },
    });

    if (!profiles.length) {
      await this.sendMessage(chatId, 'No profiles in the system yet.');
      return;
    }

    const pinned = new Set(this.settings.pinnedProfiles || []);
    const sorted = [
      ...profiles.filter((p) => pinned.has(p.id)),
      ...profiles.filter((p) => !pinned.has(p.id)),
    ];

    const buttons = sorted.map((p) => ({
      text: (pinned.has(p.id) ? '⭐ ' : '') + p.name,
      callback_data: `f:${p.id}`,
    }));
    const rows = chunk(buttons, 2);
    rows.push([{ text: '‹ Back to menu', callback_data: 'menu' }]);
    const reply_markup = { inline_keyboard: rows };
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
    cInfo?: CurrencyInfo,
  ): string {
    if (!parsed) {
      return `ℹ️ <b>${esc(profile.name)}</b>\nLogged in, but no data could be parsed from the page.`;
    }
    const AMOUNT_KEYS = new Set(['totalDepositAmount', 'totalWithdrawalAmount']);
    const lines = COMMON_FIELDS.map((k) => {
      const val = parsed.data?.[k];
      let line = `• ${COMMON_LABELS[k]}: <b>${fmtNum(val)}</b>`;
      if (AMOUNT_KEYS.has(k) && val != null && cInfo) {
        const labels = convertedLabels(val, cInfo.currency, cInfo.rates);
        if (labels.length) {
          line += ` ${esc(cInfo.currency)} <i>(${labels.map(esc).join(' · ')})</i>`;
        }
      }
      return line;
    });
    const header = `📊 <b>${esc(profile.name)}</b> <i>(${esc(profile.kind)})</i>\n🕒 ${esc(when)}`;
    return `${header}\n\n${lines.join('\n')}`;
  }

  private formatBothResult(
    profile: { name: string; kind: string },
    todayParsed: any,
    yesterdayParsed: any,
    cInfo?: CurrencyInfo,
  ): string {
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
    const header = `📊 <b>${esc(profile.name)}</b> <i>(${esc(profile.kind)})</i>\n📋 Yesterday vs Today · ${timeStr}`;

    if (!todayParsed && !yesterdayParsed) {
      return `${header}\n\nNo data could be parsed for either period.`;
    }

    const lines: string[] = [];

    lines.push('');
    lines.push('<pre>');
    lines.push(`${'Metric'.padEnd(16)} ${'Yest'.padStart(10)}  ${'Today'.padStart(10)}  ${'Chg'.padStart(6)}`);
    lines.push('─'.repeat(48));

    for (const k of COMMON_FIELDS) {
      const yVal = yesterdayParsed?.data?.[k];
      const tVal = todayParsed?.data?.[k];
      const yNum = yVal != null ? Number(yVal) : 0;
      const tNum = tVal != null ? Number(tVal) : 0;
      const diff = tNum - yNum;
      const pct = yNum ? ((diff / Math.abs(yNum)) * 100) : null;

      const label = (COMMON_LABELS[k] || k).replace('Total ', '').replace(' Count', ' Cnt').replace(' Amount', ' Amt');
      const shortLabel = label.length > 16 ? label.slice(0, 15) + '…' : label;

      const yStr = yVal != null ? fmtNum(yVal) : '—';
      const tStr = tVal != null ? fmtNum(tVal) : '—';
      const pctStr = pct != null && isFinite(pct) && Math.abs(pct) >= 0.1
        ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
        : '—';

      lines.push(`${shortLabel.padEnd(16)} ${yStr.padStart(10)}  ${tStr.padStart(10)}  ${pctStr.padStart(6)}`);
    }

    const tDep = todayParsed?.data?.totalDepositAmount != null ? Number(todayParsed.data.totalDepositAmount) : 0;
    const tWith = todayParsed?.data?.totalWithdrawalAmount != null ? Number(todayParsed.data.totalWithdrawalAmount) : 0;
    const yDep = yesterdayParsed?.data?.totalDepositAmount != null ? Number(yesterdayParsed.data.totalDepositAmount) : 0;
    const yWith = yesterdayParsed?.data?.totalWithdrawalAmount != null ? Number(yesterdayParsed.data.totalWithdrawalAmount) : 0;
    const tNet = tDep - tWith;
    const yNet = yDep - yWith;
    const netDiff = tNet - yNet;
    const netPct = yNet ? ((netDiff / Math.abs(yNet)) * 100) : null;
    const netPctStr = netPct != null && isFinite(netPct) && Math.abs(netPct) >= 0.1
      ? `${netPct > 0 ? '+' : ''}${netPct.toFixed(1)}%`
      : '—';

    lines.push('─'.repeat(48));
    const yNetStr = (yNet >= 0 ? '+' : '') + fmtNum(yNet);
    const tNetStr = (tNet >= 0 ? '+' : '') + fmtNum(tNet);
    lines.push(`${'Net Flow'.padEnd(16)} ${yNetStr.padStart(10)}  ${tNetStr.padStart(10)}  ${netPctStr.padStart(6)}`);
    lines.push('</pre>');

    if (cInfo) {
      const convParts: string[] = [];
      if (yDep) {
        const labels = convertedLabels(yDep, cInfo.currency, cInfo.rates);
        if (labels.length) convParts.push(`Yest dep: ${labels.join(' · ')}`);
      }
      if (tDep) {
        const labels = convertedLabels(tDep, cInfo.currency, cInfo.rates);
        if (labels.length) convParts.push(`Today dep: ${labels.join(' · ')}`);
      }
      if (convParts.length) {
        lines.push(`\n<i>${convParts.map(esc).join('\n')}</i>`);
      }
    }

    return `${header}\n${lines.join('\n')}`;
  }

  private resultKeyboard(profileId: string) {
    const pinned = new Set(this.settings.pinnedProfiles || []);
    const isPinned = pinned.has(profileId);
    const feat = this.settings.features || {} as TelegramFeatures;

    const rows: { text: string; callback_data: string }[][] = [
      [
        { text: '🔄 Today', callback_data: `f:${profileId}` },
        { text: '📅 Yesterday', callback_data: `y:${profileId}` },
      ],
      [{ text: '📊 Both', callback_data: `b:${profileId}` }],
    ];

    if (feat.pinFavorites) {
      rows[1].push(
        isPinned
          ? { text: '📌 Unpin', callback_data: `unpin:${profileId}` }
          : { text: '📌 Pin', callback_data: `pin:${profileId}` },
      );
    }

    rows.push([
      { text: '‹ Back to list', callback_data: 'list' },
      { text: '‹ Menu', callback_data: 'menu' },
    ]);

    return { inline_keyboard: rows };
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
        const yResult = await this.scrapesService.fetchYesterday(profile, true);
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
      const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
      if (period === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        when = `Yesterday · ${formatICTDate(y)} · ${timeStr}`;
      } else {
        when = formatICT();
      }

      if (parsed) {
        await this.loadSettings();
        const currency = currencyForPlatform(profile.kind);
        const rates = await getExchangeRates();
        const cInfo: CurrencyInfo | undefined = rates ? { currency, rates } : undefined;
        const text = this.formatResult(profile, parsed, when, cInfo);

        let png: Buffer | null = null;
        if (this.settings.sendImage) {
          png = await renderProfileCard(profile, parsed, when, cInfo);
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
          if (period === 'today') this.checkThresholdAlerts(profile, parsed).catch(() => {});
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
        if (period === 'today') this.checkThresholdAlerts(profile, parsed).catch(() => {});
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

  private async doBothFetch(chatId: number, profileId: string, username?: string) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      await this.sendMessage(chatId, 'Profile not found.');
      return;
    }

    if (this.inFlight.has(profile.id)) {
      await this.sendMessage(chatId, `⏳ ${esc(profile.name)} is already being fetched…`, { parse_mode: 'HTML' });
      return;
    }
    this.inFlight.add(profile.id);

    this.recordActivity('telegram', tgActor(chatId, username), 'fetch', profile.name, 'both');

    let statusId: number | null = null;
    try {
      const m = await this.sendMessage(chatId,
        `⏳ Fetching today + yesterday for <b>${esc(profile.name)}</b>…`,
        { parse_mode: 'HTML' },
      );
      statusId = m?.message_id ?? null;
    } catch { /* ignore */ }

    const kb = this.resultKeyboard(profile.id);

    try {
      if (!this.scrapesService) {
        await this.finishText(chatId, statusId, `❌ Scrapes service not available.`);
        return;
      }

      const tResult = await this.scrapesService.runAndSave(profile, 'today');
      let todayParsed: any = tResult.parsed || null;
      if (!todayParsed && tResult.scrape) {
        todayParsed = {
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

      const yResult = await this.scrapesService.fetchYesterday(profile, true);
      let yesterdayParsed: any = null;
      if (yResult.scrape) {
        yesterdayParsed = {
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
      }

      if (tResult.loggedIn === false) {
        const prevStatus = profile.status;
        if (tResult.accessDenied) {
          await this.prisma.profile.update({ where: { id: profile.id }, data: { status: 'ACCESS_DENIED' } });
          if (prevStatus !== 'ACCESS_DENIED') this.sendAccessDeniedAlert(profile, 'Telegram fetch');
          await this.finishText(chatId, statusId,
            `🚫 <b>${esc(profile.name)}</b>\nAccess denied — re-login this profile.`, kb);
          return;
        }
        await this.prisma.profile.update({ where: { id: profile.id }, data: { status: 'LOGGED_OUT' } });
        if (prevStatus !== 'LOGGED_OUT') this.sendSessionAlert(profile, 'Telegram fetch');
        await this.finishText(chatId, statusId,
          `⚠️ <b>${esc(profile.name)}</b>\nSession expired — open the dashboard and click <b>Login</b>.`, kb);
        return;
      }

      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { status: 'LOGGED_IN' },
      }).catch(() => {});

      await this.loadSettings();
      const currency = currencyForPlatform(profile.kind);
      const rates = await getExchangeRates();
      const cInfo: CurrencyInfo | undefined = rates ? { currency, rates } : undefined;

      const text = this.formatBothResult(profile, todayParsed, yesterdayParsed, cInfo);

      await this.finishText(chatId, statusId, text, kb);
      this.logs.logEvent({
        type: 'telegram',
        profileId: profile.id,
        message: 'Telegram fetch: both sent',
      });
    } catch (err: any) {
      this.logger.error(`Telegram both-fetch failed: ${err.message}`);
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { status: 'ERROR' },
      }).catch(() => {});
      this.logs.logEvent({
        type: 'error',
        profileId: profile.id,
        message: `Telegram both-fetch failed: ${err.message}`,
      });
      await this.finishText(chatId, statusId,
        `❌ <b>${esc(profile.name)}</b>\nFetch failed: ${esc(err.message)}`, kb);
    } finally {
      this.inFlight.delete(profile.id);
    }
  }

  // --- Summary (all profiles) ---

  private async sendSummaryMenu(chatId: number, messageId?: number) {
    const text = '📊 <b>Summary — All Profiles</b>\nSelect period:';
    const kb = {
      inline_keyboard: [
        [
          { text: '🔄 Today', callback_data: 'summary:today' },
          { text: '📅 Yesterday', callback_data: 'summary:yesterday' },
        ],
        [{ text: '‹ Back to menu', callback_data: 'menu' }],
      ],
    };
    const payload: any = { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: kb };
    if (messageId) {
      await this.call('editMessageText', { ...payload, message_id: messageId }).catch(() =>
        this.call('sendMessage', payload),
      );
    } else {
      await this.call('sendMessage', payload);
    }
  }

  private async doSummary(chatId: number, period: 'today' | 'yesterday', messageId?: number) {
    try {
      const profiles = await this.prisma.profile.findMany();
      const { businessDayDate, yesterdayBusinessDate } = await import('../common/business-day');
      const targetDate = period === 'yesterday' ? yesterdayBusinessDate() : businessDayDate();
      const periodLabel = period === 'yesterday' ? 'Yesterday' : 'Today';

      const scrapes = await this.prisma.scrape.findMany({
        where: { reportDate: targetDate },
        include: { profile: true },
      });

      const byPlatform: Record<string, { dep: number; with: number; count: number }> = {};
      let totalDep = 0;
      let totalWith = 0;
      let totalProfiles = 0;

      for (const s of scrapes) {
        const dep = s.totalDepositAmount ? Number(s.totalDepositAmount) : 0;
        const wit = s.totalWithdrawalAmount ? Number(s.totalWithdrawalAmount) : 0;
        totalDep += dep;
        totalWith += wit;
        totalProfiles++;
        const kind = s.profile?.kind || 'UNKNOWN';
        if (!byPlatform[kind]) byPlatform[kind] = { dep: 0, with: 0, count: 0 };
        byPlatform[kind].dep += dep;
        byPlatform[kind].with += wit;
        byPlatform[kind].count++;
      }

      const dateLabel = formatICTDate(targetDate);
      const lines: string[] = [
        `📊 <b>Summary — ${periodLabel}</b>`,
        `🕒 ${esc(dateLabel)} · ${esc(formatICT())}`,
        ``,
        `<pre>`,
        `Profiles fetched: ${totalProfiles}/${profiles.length}`,
        ``,
      ];

      for (const [kind, data] of Object.entries(byPlatform)) {
        const net = data.dep - data.with;
        lines.push(`${kind} (${data.count} profiles)`);
        lines.push(`  Deposits:    ${fmtNum(data.dep)}`);
        lines.push(`  Withdrawals: ${fmtNum(data.with)}`);
        lines.push(`  Net Flow:    ${(net >= 0 ? '+' : '')}${fmtNum(net)}`);
        lines.push(``);
      }

      lines.push(`─`.repeat(30));
      const totalNet = totalDep - totalWith;
      lines.push(`TOTAL`);
      lines.push(`  Deposits:    ${fmtNum(totalDep)}`);
      lines.push(`  Withdrawals: ${fmtNum(totalWith)}`);
      lines.push(`  Net Flow:    ${(totalNet >= 0 ? '+' : '')}${fmtNum(totalNet)}`);
      lines.push(`</pre>`);

      const rates = await getExchangeRates();
      if (rates) {
        const convParts: string[] = [];
        for (const [kind, data] of Object.entries(byPlatform)) {
          const currency = currencyForPlatform(kind);
          const labels = convertedLabels(data.dep, currency, rates);
          if (labels.length) convParts.push(`${kind} dep: ${labels.join(' · ')}`);
        }
        if (convParts.length) {
          lines.push(`\n<i>${convParts.map(esc).join('\n')}</i>`);
        }
      }

      if (profiles.length > totalProfiles) {
        const missing = profiles.filter((p) => !scrapes.find((s) => s.profileId === p.id));
        const missingNames = missing.slice(0, 5).map((p) => p.name).join(', ');
        const extra = missing.length > 5 ? ` +${missing.length - 5} more` : '';
        lines.push(`\n⚠️ <i>Not fetched: ${esc(missingNames)}${extra}</i>`);
      }

      const text = lines.join('\n');
      const kb = {
        inline_keyboard: [
          [
            { text: '🔄 Today', callback_data: 'summary:today' },
            { text: '📅 Yesterday', callback_data: 'summary:yesterday' },
          ],
          [{ text: '‹ Back to menu', callback_data: 'menu' }],
        ],
      };

      let png: Buffer | null = null;
      if (this.settings.summaryImage) {
        const imgRates = rates || await getExchangeRates();
        const platformData: SummaryPlatform[] = Object.entries(byPlatform).map(([kind, data]) => {
          const currency = currencyForPlatform(kind);
          const convLabels = imgRates ? convertedLabels(data.dep, currency, imgRates) : [];
          return { kind, count: data.count, dep: data.dep, with: data.with, convLabels };
        });
        const missing = profiles.filter((p) => !scrapes.find((s) => s.profileId === p.id));
        const missingNames = missing.map((p) => p.name);
        png = await renderSummaryCard(
          periodLabel, dateLabel, platformData, totalDep, totalWith, totalProfiles, profiles.length, missingNames,
        );
      }

      if (png) {
        if (messageId) {
          await this.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
        }
        await this.sendPhoto(chatId, png, {
          caption: this.settings.summaryText ? text : undefined,
          reply_markup: kb,
        });
        if (this.settings.summaryText && text.length > 1024) {
          await this.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb });
        }
      } else {
        await this.finishText(chatId, messageId ?? null, text, kb);
      }
    } catch (err: any) {
      this.logger.error(`Summary failed: ${err.message}`);
      await this.sendMessage(chatId, `❌ Summary failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
    }
  }

  // --- Rankings ---

  private async sendRankingsMenu(chatId: number, messageId?: number) {
    const text = '🏆 <b>Rankings — By Deposits</b>\nSelect period:';
    const kb = {
      inline_keyboard: [
        [
          { text: '🔄 Today', callback_data: 'rankings:today' },
          { text: '📅 Yesterday', callback_data: 'rankings:yesterday' },
        ],
        [{ text: '‹ Back to menu', callback_data: 'menu' }],
      ],
    };
    const payload: any = { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: kb };
    if (messageId) {
      await this.call('editMessageText', { ...payload, message_id: messageId }).catch(() =>
        this.call('sendMessage', payload),
      );
    } else {
      await this.call('sendMessage', payload);
    }
  }

  private async doRankings(chatId: number, period: 'today' | 'yesterday', messageId?: number) {
    try {
      const { businessDayDate, yesterdayBusinessDate } = await import('../common/business-day');
      const targetDate = period === 'yesterday' ? yesterdayBusinessDate() : businessDayDate();
      const periodLabel = period === 'yesterday' ? 'Yesterday' : 'Today';

      const scrapes = await this.prisma.scrape.findMany({
        where: { reportDate: targetDate },
        include: { profile: true },
      });

      const periodKb = {
        inline_keyboard: [
          [
            { text: '🔄 Today', callback_data: 'rankings:today' },
            { text: '📅 Yesterday', callback_data: 'rankings:yesterday' },
          ],
          [{ text: '‹ Back to menu', callback_data: 'menu' }],
        ],
      };

      if (!scrapes.length) {
        await this.finishText(chatId, messageId ?? null, `🏆 <b>Rankings — ${periodLabel}</b>\n\nNo data for ${periodLabel.toLowerCase()} yet.`, periodKb);
        return;
      }

      const ranked = scrapes
        .map((s) => ({
          name: s.profile?.name || 'Unknown',
          dep: s.totalDepositAmount ? Number(s.totalDepositAmount) : 0,
          with: s.totalWithdrawalAmount ? Number(s.totalWithdrawalAmount) : 0,
        }))
        .sort((a, b) => b.dep - a.dep);

      const maxDep = ranked[0]?.dep || 1;
      const dateLabel = formatICTDate(targetDate);
      const lines: string[] = [
        `🏆 <b>Rankings — ${periodLabel}</b>`,
        `🕒 ${esc(dateLabel)} · ${esc(formatICT())}`,
        ``,
        `<pre>`,
      ];

      for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i];
        const barLen = Math.max(1, Math.round((r.dep / maxDep) * 10));
        const bar = '█'.repeat(barLen) + '░'.repeat(10 - barLen);
        const name = r.name.length > 10 ? r.name.slice(0, 9) + '…' : r.name;
        lines.push(`${String(i + 1).padStart(2)}. ${name.padEnd(10)} ${bar} ${fmtNum(r.dep)}`);
      }
      lines.push(`</pre>`);

      const topNet = [...ranked].sort((a, b) => (b.dep - b.with) - (a.dep - a.with));
      lines.push(``);
      lines.push(`<b>Net Flow Leaders:</b>`);
      for (let i = 0; i < Math.min(3, topNet.length); i++) {
        const r = topNet[i];
        const net = r.dep - r.with;
        lines.push(`  ${i + 1}. ${esc(r.name)}: ${net >= 0 ? '+' : ''}${fmtNum(net)}`);
      }

      if (topNet.length > 3) {
        lines.push(``);
        lines.push(`<b>Lowest Net Flow:</b>`);
        for (let i = Math.max(topNet.length - 3, 3); i < topNet.length; i++) {
          const r = topNet[i];
          const net = r.dep - r.with;
          lines.push(`  ${i + 1}. ${esc(r.name)}: ${net >= 0 ? '+' : ''}${fmtNum(net)}`);
        }
      }

      const text = lines.join('\n');

      let png: Buffer | null = null;
      if (this.settings.rankingsImage) {
        const rankEntries: RankingEntry[] = ranked.map((r) => ({
          name: r.name,
          dep: r.dep,
          net: r.dep - r.with,
        }));
        png = await renderRankingsCard(periodLabel, dateLabel, rankEntries);
      }

      if (png) {
        if (messageId) {
          await this.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
        }
        await this.sendPhoto(chatId, png, {
          caption: this.settings.rankingsText ? text : undefined,
          reply_markup: periodKb,
        });
        if (this.settings.rankingsText && text.length > 1024) {
          await this.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: periodKb });
        }
      } else {
        await this.finishText(chatId, messageId ?? null, text, periodKb);
      }
    } catch (err: any) {
      this.logger.error(`Rankings failed: ${err.message}`);
      await this.sendMessage(chatId, `❌ Rankings failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
    }
  }

  // --- Status Check ---

  private async doStatus(chatId: number, messageId?: number) {
    try {
      const profiles = await this.prisma.profile.findMany({ orderBy: { name: 'asc' } });

      const statusIcon: Record<string, string> = {
        LOGGED_IN: '🟢',
        LOGGED_OUT: '🔴',
        ERROR: '🟡',
        ACCESS_DENIED: '🚫',
        NEVER: '⚪',
      };

      const groups: Record<string, string[]> = {};
      for (const p of profiles) {
        const s = p.status || 'NEVER';
        if (!groups[s]) groups[s] = [];
        groups[s].push(p.name);
      }

      const lines: string[] = [
        `🔍 <b>Status Check</b>`,
        `🕒 ${esc(formatICT())}`,
        ``,
      ];

      const order = ['LOGGED_IN', 'LOGGED_OUT', 'ACCESS_DENIED', 'ERROR', 'NEVER'];
      for (const status of order) {
        const names = groups[status];
        if (!names?.length) continue;
        const icon = statusIcon[status] || '❓';
        const label = status.replace('_', ' ');
        lines.push(`${icon} <b>${label}</b> (${names.length})`);
        for (const name of names) {
          lines.push(`   ${esc(name)}`);
        }
        lines.push(``);
      }

      const loggedIn = groups['LOGGED_IN']?.length || 0;
      lines.push(`<i>${loggedIn}/${profiles.length} profiles online</i>`);

      const text = lines.join('\n');
      const kb = { inline_keyboard: [[{ text: '‹ Back to menu', callback_data: 'menu' }]] };

      let png: Buffer | null = null;
      if (this.settings.statusImage) {
        const statusGroups: StatusGroup[] = order
          .filter((s) => groups[s]?.length)
          .map((s) => ({ status: s, icon: statusIcon[s] || '❓', names: groups[s] }));
        png = await renderStatusCard(formatICT(), statusGroups, loggedIn, profiles.length);
      }

      if (png) {
        if (messageId) {
          await this.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
        }
        await this.sendPhoto(chatId, png, {
          caption: this.settings.statusText ? text : undefined,
          reply_markup: kb,
        });
        if (this.settings.statusText && text.length > 1024) {
          await this.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: kb });
        }
      } else {
        await this.finishText(chatId, messageId ?? null, text, kb);
      }
    } catch (err: any) {
      this.logger.error(`Status check failed: ${err.message}`);
      await this.sendMessage(chatId, `❌ Status check failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
    }
  }

  // --- Pin/Unpin ---

  private async doTogglePin(chatId: number, profileId: string) {
    try {
      if (!this.settingsService) {
        await this.sendMessage(chatId, '❌ Settings service not available.');
        return;
      }
      const isPinned = await this.settingsService.togglePinnedProfile(profileId);
      await this.loadSettings();

      const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
      const name = profile?.name || 'Profile';
      const msg = isPinned
        ? `📌 <b>${esc(name)}</b> pinned — it will appear first in the list.`
        : `📌 <b>${esc(name)}</b> unpinned.`;
      await this.sendMessage(chatId, msg, { parse_mode: 'HTML' });
    } catch (err: any) {
      this.logger.error(`Pin toggle failed: ${err.message}`);
      await this.sendMessage(chatId, `❌ Pin failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
    }
  }

  // --- Scheduled Push ---

  private startPushTimer() {
    if (this.pushTimer) { clearInterval(this.pushTimer); this.pushTimer = null; }
    this.pushTimer = setInterval(() => this.checkScheduledPush(), 60_000);
  }

  private async checkScheduledPush() {
    try {
      await this.loadSettings();
      if (!this.settings.features?.scheduledPush) return;
      if (!this.token || !this.settings.alertChatIds.length) return;

      const pushCfg = this.settings.scheduledPush || { time: '11:30', lastSentDate: '' };
      const [targetH, targetM] = pushCfg.time.split(':').map(Number);

      const now = new Date();
      const bangkokTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      const getP = (type: string) => parseInt(bangkokTime.find((p) => p.type === type)?.value || '0', 10);
      const nowH = getP('hour');
      const nowM = getP('minute');

      if (nowH !== targetH || nowM !== targetM) return;

      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
      if (pushCfg.lastSentDate === dateStr) return;

      await this.saveSettings({
        ...this.settings,
        scheduledPush: { ...pushCfg, lastSentDate: dateStr },
      } as any);

      const summaryText = await this.buildSummaryText();
      const header = `⏰ <b>Scheduled Daily Summary</b>\n${summaryText}`;

      for (const chatId of this.settings.alertChatIds) {
        await this.sendMessage(chatId, header, { parse_mode: 'HTML' }).catch(() => {});
      }

      this.logs.logEvent({ type: 'telegram', message: `Scheduled push sent to ${this.settings.alertChatIds.length} chats` });
    } catch (err: any) {
      this.logger.error(`Scheduled push failed: ${err.message}`);
    }
  }

  private async buildSummaryText(): Promise<string> {
    const { businessDayDate } = await import('../common/business-day');
    const today = businessDayDate();
    const profiles = await this.prisma.profile.findMany();
    const scrapes = await this.prisma.scrape.findMany({
      where: { reportDate: today },
      include: { profile: true },
    });

    let totalDep = 0, totalWith = 0;
    for (const s of scrapes) {
      totalDep += s.totalDepositAmount ? Number(s.totalDepositAmount) : 0;
      totalWith += s.totalWithdrawalAmount ? Number(s.totalWithdrawalAmount) : 0;
    }
    const net = totalDep - totalWith;

    const lines: string[] = [
      `🕒 ${esc(formatICT())}`,
      ``,
      `<pre>`,
      `Profiles: ${scrapes.length}/${profiles.length} fetched`,
      `Deposits:    ${fmtNum(totalDep)}`,
      `Withdrawals: ${fmtNum(totalWith)}`,
      `Net Flow:    ${(net >= 0 ? '+' : '')}${fmtNum(net)}`,
      `</pre>`,
    ];

    const loggedOut = profiles.filter((p) => p.status === 'LOGGED_OUT' || p.status === 'ACCESS_DENIED');
    if (loggedOut.length) {
      lines.push(`\n⚠️ <i>${loggedOut.length} profile(s) need attention: ${loggedOut.map((p) => esc(p.name)).join(', ')}</i>`);
    }

    return lines.join('\n');
  }

  // --- Threshold Alerts ---

  async checkThresholdAlerts(profile: { id: string; name: string; kind: string }, todayParsed: any) {
    try {
      await this.loadSettings();
      if (!this.settings.features?.thresholdAlerts) return;
      if (!this.token || !this.settings.alertChatIds.length) return;

      const cfg = this.settings.thresholdAlerts;
      if (!cfg) return;

      const { yesterdayBusinessDate } = await import('../common/business-day');
      const yesterday = yesterdayBusinessDate();
      const yScrape = await this.prisma.scrape.findFirst({
        where: { profileId: profile.id, reportDate: yesterday },
      });

      if (!yScrape) return;

      const tDep = todayParsed?.data?.totalDepositAmount != null ? Number(todayParsed.data.totalDepositAmount) : null;
      const yDep = yScrape.totalDepositAmount ? Number(yScrape.totalDepositAmount) : null;
      const tWith = todayParsed?.data?.totalWithdrawalAmount != null ? Number(todayParsed.data.totalWithdrawalAmount) : null;
      const yWith = yScrape.totalWithdrawalAmount ? Number(yScrape.totalWithdrawalAmount) : null;

      const alerts: string[] = [];

      if (cfg.depositDropPercent && tDep != null && yDep != null && yDep > 0) {
        const dropPct = ((yDep - tDep) / yDep) * 100;
        if (dropPct >= cfg.depositDropPercent) {
          alerts.push(`📉 Deposits dropped ${dropPct.toFixed(1)}% (${fmtNum(yDep)} → ${fmtNum(tDep)})`);
        }
      }

      if (cfg.negativeNetFlow && tDep != null && tWith != null) {
        const tNet = tDep - tWith;
        if (tNet < 0) {
          alerts.push(`⚠️ Net flow is negative: ${fmtNum(tNet)}`);
        }
      }

      if (!alerts.length) return;

      const text = [
        `🔔 <b>Threshold Alert — ${esc(profile.name)}</b>`,
        `🕒 ${esc(formatICT())}`,
        ``,
        ...alerts,
      ].join('\n');

      for (const chatId of this.settings.alertChatIds) {
        await this.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
      }

      this.logs.logEvent({ type: 'alert', message: `Threshold alert for ${profile.name}: ${alerts.length} trigger(s)` });
    } catch (err: any) {
      this.logger.error(`Threshold alert check failed: ${err.message}`);
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

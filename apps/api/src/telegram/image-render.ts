import { chromium, Browser } from 'playwright';
import { COMMON_FIELDS, COMMON_LABELS, ParseResult } from '../scraper/parsers/common';
import { convertedLabels, CurrencyInfo } from '../common/currency';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const channel = process.env.BROWSER_CHANNEL ?? 'chrome';
    const opts: any = { headless: true };
    if (channel) opts.channel = channel;
    browserPromise = chromium.launch(opts).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c,
  );
}

function fmtNum(v: unknown): string {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toLocaleString('en-US') : esc(String(v));
}

const AMOUNT_FIELDS = new Set(['totalDepositAmount', 'totalWithdrawalAmount']);

function cardHtml(
  profile: { name: string; kind: string },
  parsed: ParseResult,
  when: string,
  cInfo?: CurrencyInfo,
): string {
  const tiles = COMMON_FIELDS.map((k) => {
    const val = parsed.data?.[k];
    const valueColor = AMOUNT_FIELDS.has(k) ? '#82aaff' : '#e6e8eb';
    let convLine = '';
    if (AMOUNT_FIELDS.has(k) && val != null && cInfo) {
      const labels = convertedLabels(val, cInfo.currency, cInfo.rates);
      if (labels.length) {
        convLine = `<div class="tile-conv">${labels.map(esc).join(' · ')}</div>`;
      }
    }
    return `
      <div class="tile">
        <div class="tile-label">${esc(COMMON_LABELS[k])}</div>
        <div class="tile-value" style="color:${valueColor}">${fmtNum(val)}</div>
        ${convLine}
      </div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: transparent;
    }
    #card {
      width: 620px;
      background: #181b22;
      border: 1px solid #262a33;
      border-radius: 16px;
      padding: 28px 30px;
      color: #e6e8eb;
    }
    .head { display: flex; align-items: center; justify-content: space-between; }
    .name { font-size: 28px; font-weight: 700; letter-spacing: 0.5px; }
    .badge {
      font-size: 13px; font-weight: 600; color: #82aaff;
      background: rgba(79,140,255,0.15);
      padding: 5px 12px; border-radius: 999px;
    }
    .when { color: #8a929e; font-size: 14px; margin-top: 4px; }
    .divider { height: 1px; background: #262a33; margin: 22px 0; }
    .grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    }
    .tile {
      background: #0f1115; border: 1px solid #262a33;
      border-radius: 12px; padding: 16px 18px;
    }
    .tile-label {
      font-size: 12px; font-weight: 600; color: #8a929e;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .tile-value { font-size: 26px; font-weight: 700; margin-top: 6px; }
    .tile-conv { font-size: 13px; font-weight: 500; color: #6ce19a; margin-top: 2px; }
    .foot {
      display: flex; align-items: center; gap: 8px;
      margin-top: 22px; color: #8a929e; font-size: 13px;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #6ce19a; }
  </style></head>
  <body>
    <div id="card">
      <div class="head">
        <div class="name">${esc(profile.name)}</div>
        <div class="badge">${esc(profile.kind)}</div>
      </div>
      <div class="when">${esc(when)}</div>
      <div class="divider"></div>
      <div class="grid">${tiles}</div>
      <div class="foot"><span class="dot"></span>Scraper Dashboard · live fetch</div>
    </div>
  </body></html>`;
}

export async function renderProfileCard(
  profile: { name: string; kind: string },
  parsed: ParseResult,
  when: string,
  cInfo?: CurrencyInfo,
): Promise<Buffer | null> {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(cardHtml(profile, parsed, when, cInfo), { waitUntil: 'load' });
    const el = await page.$('#card');
    if (!el) return null;
    return (await el.screenshot({ type: 'png' })) as Buffer;
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Shared card styles ──

const BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: transparent; }
  #card { width: 620px; background: #181b22; border: 1px solid #262a33; border-radius: 16px; padding: 28px 30px; color: #e6e8eb; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .title { font-size: 24px; font-weight: 700; }
  .sub { color: #8a929e; font-size: 13px; margin-top: 4px; }
  .divider { height: 1px; background: #262a33; margin: 20px 0; }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 20px; color: #8a929e; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6ce19a; }
`;

// ── Summary Card ──

export interface SummaryPlatform {
  kind: string;
  count: number;
  dep: number;
  with: number;
  convLabels?: string[];
}

function summaryCardHtml(
  period: string,
  dateLabel: string,
  platforms: SummaryPlatform[],
  totalDep: number,
  totalWith: number,
  fetched: number,
  total: number,
  missingNames?: string[],
): string {
  const platformBlocks = platforms.map((p) => {
    const net = p.dep - p.with;
    return `
      <div class="plat">
        <div class="plat-head">
          <span class="plat-name">${esc(p.kind)}</span>
          <span class="plat-count">${p.count} profile${p.count > 1 ? 's' : ''}</span>
        </div>
        <div class="plat-grid">
          <div class="plat-metric"><span class="plat-label">Deposits</span><span class="plat-val dep">${fmtNum(p.dep)}</span></div>
          <div class="plat-metric"><span class="plat-label">Withdrawals</span><span class="plat-val">${fmtNum(p.with)}</span></div>
          <div class="plat-metric"><span class="plat-label">Net Flow</span><span class="plat-val ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmtNum(net)}</span></div>
        </div>
        ${p.convLabels?.length ? `<div class="plat-conv">${p.convLabels.map(esc).join(' · ')}</div>` : ''}
      </div>`;
  }).join('');

  const totalNet = totalDep - totalWith;

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    ${BASE_STYLES}
    .fetch-badge { font-size: 12px; font-weight: 600; color: #82aaff; background: rgba(79,140,255,0.15); padding: 4px 10px; border-radius: 999px; }
    .plat { background: #0f1115; border: 1px solid #262a33; border-radius: 12px; padding: 16px 18px; margin-bottom: 12px; }
    .plat-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .plat-name { font-size: 15px; font-weight: 700; color: #82aaff; }
    .plat-count { font-size: 11px; color: #8a929e; }
    .plat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .plat-metric { display: flex; flex-direction: column; gap: 2px; }
    .plat-label { font-size: 10px; font-weight: 600; color: #8a929e; text-transform: uppercase; letter-spacing: 0.05em; }
    .plat-val { font-size: 18px; font-weight: 700; color: #e6e8eb; }
    .plat-val.dep { color: #82aaff; }
    .plat-val.pos { color: #6ce19a; }
    .plat-val.neg { color: #ff5d5d; }
    .plat-conv { font-size: 11px; color: #6ce19a; margin-top: 8px; font-weight: 500; }
    .total-bar { background: #0f1115; border: 1px solid #3a3f4b; border-radius: 12px; padding: 16px 18px; }
    .total-label { font-size: 11px; font-weight: 700; color: #8a929e; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
    .total-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .total-val { font-size: 22px; font-weight: 700; }
    .missing { font-size: 11px; color: #fbbf24; margin-top: 12px; }
  </style></head><body>
    <div id="card">
      <div class="head">
        <div class="title">📊 Summary — ${esc(period)}</div>
        <div class="fetch-badge">${fetched}/${total} fetched</div>
      </div>
      <div class="sub">${esc(dateLabel)}</div>
      <div class="divider"></div>
      ${platformBlocks}
      <div class="total-bar">
        <div class="total-label">Total</div>
        <div class="total-grid">
          <div class="plat-metric"><span class="plat-label">Deposits</span><span class="total-val dep">${fmtNum(totalDep)}</span></div>
          <div class="plat-metric"><span class="plat-label">Withdrawals</span><span class="total-val">${fmtNum(totalWith)}</span></div>
          <div class="plat-metric"><span class="plat-label">Net Flow</span><span class="total-val ${totalNet >= 0 ? 'pos' : 'neg'}">${totalNet >= 0 ? '+' : ''}${fmtNum(totalNet)}</span></div>
        </div>
      </div>
      ${missingNames?.length ? `<div class="missing">⚠️ Not fetched: ${missingNames.slice(0, 5).map(esc).join(', ')}${missingNames.length > 5 ? ` +${missingNames.length - 5} more` : ''}</div>` : ''}
      <div class="foot"><span class="dot"></span>Scraper Dashboard</div>
    </div>
  </body></html>`;
}

export async function renderSummaryCard(
  period: string,
  dateLabel: string,
  platforms: SummaryPlatform[],
  totalDep: number,
  totalWith: number,
  fetched: number,
  total: number,
  missingNames?: string[],
): Promise<Buffer | null> {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(summaryCardHtml(period, dateLabel, platforms, totalDep, totalWith, fetched, total, missingNames), { waitUntil: 'load' });
    const el = await page.$('#card');
    if (!el) return null;
    return (await el.screenshot({ type: 'png' })) as Buffer;
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Rankings Card ──

export interface RankingEntry {
  name: string;
  dep: number;
  net: number;
}

function rankingsCardHtml(
  period: string,
  dateLabel: string,
  ranked: RankingEntry[],
): string {
  const maxDep = ranked[0]?.dep || 1;
  const rows = ranked.map((r, i) => {
    const pct = Math.max(2, Math.round((r.dep / maxDep) * 100));
    return `
      <div class="rank-row">
        <span class="rank-num">${i + 1}</span>
        <span class="rank-name">${esc(r.name)}</span>
        <div class="rank-bar-wrap"><div class="rank-bar" style="width:${pct}%"></div></div>
        <span class="rank-dep">${fmtNum(r.dep)}</span>
      </div>`;
  }).join('');

  const topNet = [...ranked].sort((a, b) => b.net - a.net);
  const bottomNet = [...ranked].sort((a, b) => a.net - b.net);
  const leaders = topNet.slice(0, 3).map((r, i) => `
    <div class="net-row">
      <span class="net-pos">${i + 1}.</span>
      <span class="net-name">${esc(r.name)}</span>
      <span class="net-val ${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '+' : ''}${fmtNum(r.net)}</span>
    </div>`).join('');
  const laggards = ranked.length > 3 ? bottomNet.slice(0, 3).filter((r) => !topNet.slice(0, 3).includes(r)).map((r, i) => `
    <div class="net-row">
      <span class="net-pos">${ranked.length - (bottomNet.indexOf(r))}.</span>
      <span class="net-name">${esc(r.name)}</span>
      <span class="net-val ${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '+' : ''}${fmtNum(r.net)}</span>
    </div>`).join('') : '';

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    ${BASE_STYLES}
    .rank-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; }
    .rank-num { font-size: 13px; font-weight: 700; color: #8a929e; min-width: 22px; text-align: right; }
    .rank-name { font-size: 13px; font-weight: 600; color: #e6e8eb; min-width: 100px; }
    .rank-bar-wrap { flex: 1; height: 18px; background: #0f1115; border-radius: 4px; overflow: hidden; }
    .rank-bar { height: 100%; background: linear-gradient(90deg, #4f8cff, #82aaff); border-radius: 4px; }
    .rank-dep { font-size: 13px; font-weight: 700; color: #82aaff; min-width: 110px; text-align: right; }
    .net-section { background: #0f1115; border: 1px solid #262a33; border-radius: 12px; padding: 14px 18px; margin-top: 14px; }
    .net-title { font-size: 11px; font-weight: 700; color: #8a929e; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
    .net-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
    .net-pos { font-size: 12px; color: #8a929e; min-width: 18px; }
    .net-name { font-size: 13px; font-weight: 500; color: #e6e8eb; flex: 1; }
    .net-val { font-size: 14px; font-weight: 700; }
    .net-val.pos { color: #6ce19a; }
    .net-val.neg { color: #ff5d5d; }
    .net-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  </style></head><body>
    <div id="card">
      <div class="head"><div class="title">🏆 Rankings — ${esc(period)}</div></div>
      <div class="sub">${esc(dateLabel)}</div>
      <div class="divider"></div>
      ${rows}
      <div class="net-cols">
        <div class="net-section">
          <div class="net-title">Top Net Flow</div>
          ${leaders}
        </div>
        ${laggards ? `<div class="net-section"><div class="net-title">Lowest Net Flow</div>${laggards}</div>` : ''}
      </div>
      <div class="foot"><span class="dot"></span>Scraper Dashboard</div>
    </div>
  </body></html>`;
}

export async function renderRankingsCard(
  period: string,
  dateLabel: string,
  ranked: RankingEntry[],
): Promise<Buffer | null> {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(rankingsCardHtml(period, dateLabel, ranked), { waitUntil: 'load' });
    const el = await page.$('#card');
    if (!el) return null;
    return (await el.screenshot({ type: 'png' })) as Buffer;
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Status Card ──

export interface StatusGroup {
  status: string;
  icon: string;
  names: string[];
}

function statusCardHtml(dateLabel: string, groups: StatusGroup[], loggedIn: number, total: number): string {
  const groupBlocks = groups.map((g) => {
    const names = g.names.map((n) => `<span class="st-name">${esc(n)}</span>`).join('');
    const statusColor = g.status === 'LOGGED_IN' ? '#6ce19a' : g.status === 'LOGGED_OUT' ? '#ff5d5d' : g.status === 'ACCESS_DENIED' ? '#ff8c42' : g.status === 'ERROR' ? '#fbbf24' : '#8a929e';
    return `
      <div class="st-group">
        <div class="st-head" style="color: ${statusColor}">
          <span>${g.icon} ${esc(g.status.replace('_', ' '))}</span>
          <span class="st-count">${g.names.length}</span>
        </div>
        <div class="st-names">${names}</div>
      </div>`;
  }).join('');

  const pct = total > 0 ? Math.round((loggedIn / total) * 100) : 0;

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    ${BASE_STYLES}
    .status-badge { font-size: 14px; font-weight: 700; color: ${loggedIn === total ? '#6ce19a' : '#fbbf24'}; }
    .pbar-wrap { height: 8px; background: #0f1115; border-radius: 4px; overflow: hidden; margin-top: 12px; }
    .pbar { height: 100%; background: linear-gradient(90deg, #6ce19a, #34d399); border-radius: 4px; }
    .st-group { background: #0f1115; border: 1px solid #262a33; border-radius: 12px; padding: 14px 18px; margin-bottom: 10px; }
    .st-head { font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; text-transform: uppercase; letter-spacing: 0.04em; }
    .st-count { font-size: 11px; background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 999px; }
    .st-names { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .st-name { font-size: 12px; font-weight: 500; color: #e6e8eb; background: #181b22; border: 1px solid #262a33; padding: 3px 10px; border-radius: 6px; }
  </style></head><body>
    <div id="card">
      <div class="head">
        <div class="title">🔍 Status Check</div>
        <div class="status-badge">${loggedIn}/${total} online</div>
      </div>
      <div class="sub">${esc(dateLabel)}</div>
      <div class="pbar-wrap"><div class="pbar" style="width:${pct}%"></div></div>
      <div class="divider"></div>
      ${groupBlocks}
      <div class="foot"><span class="dot"></span>Scraper Dashboard</div>
    </div>
  </body></html>`;
}

export async function renderStatusCard(
  dateLabel: string,
  groups: StatusGroup[],
  loggedIn: number,
  total: number,
): Promise<Buffer | null> {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(statusCardHtml(dateLabel, groups, loggedIn, total), { waitUntil: 'load' });
    const el = await page.$('#card');
    if (!el) return null;
    return (await el.screenshot({ type: 'png' })) as Buffer;
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch { /* ignore */ }
  browserPromise = null;
}

'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Profile {
  id: string;
  name: string;
  kind: string;
  status: string;
  lastScrapeAt: string | null;
  lastLoginAt: string | null;
}

interface TodayScrape {
  profileId: string;
  reportDateString: string;
  newRegistrationCount: number | null;
  newDepositCount: number | null;
  totalDepositCount: number | null;
  totalDepositAmount: string | null;
  totalWithdrawalCount: number | null;
  totalWithdrawalAmount: string | null;
  profile: { name: string; kind: string };
}

interface SchedulerInfo {
  settings: { fetch: { enabled: boolean; intervalMs: number }; refresh: { enabled: boolean; intervalMs: number } };
  runtime: { fetchTimers: number; refreshTimers: number; runningCount: number };
}

interface ActivityEntry {
  id: string;
  actorType: string;
  action: string;
  target: string;
  details: string;
  createdAt: string;
  actor?: { name: string } | null;
}

function numVal(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function fmtCompact(n: number, isAmount = false): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return isAmount ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString('en-US');
}

function fmt(n: number, isAmount = false): string {
  return isAmount ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString('en-US');
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function msToReadable(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Sparkline({ values, color, height = 28 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return null;
  const W = 100, H = height;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * W, y: H - 2 - (v / max) * (H - 6) }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = line + ` L${pts[pts.length - 1].x},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height }}>
      <path d={area} fill={color} opacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2} fill={color} />
    </svg>
  );
}

const STATUS_ORDER: Record<string, number> = { ACCESS_DENIED: 0, ERROR: 1, LOGGED_OUT: 2, SCRAPING: 3, LOGGED_IN: 4, IDLE: 5 };
const ISSUE_STATUSES = ['LOGGED_OUT', 'ACCESS_DENIED', 'ERROR'];

export default function DashboardHome() {
  const { hasPrivilege } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [todayScrapes, setTodayScrapes] = useState<TodayScrape[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerInfo | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [weekScrapes, setWeekScrapes] = useState<TodayScrape[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const promises: Promise<void>[] = [];

    if (hasPrivilege('profiles.view')) {
      promises.push(api.get<Profile[]>('/profiles').then(setProfiles).catch(() => {}));
      promises.push(api.get<TodayScrape[]>('/scrapes').then(setTodayScrapes).catch(() => {}));

      const to = new Date();
      const from = new Date(); from.setDate(from.getDate() - 6);
      const toStr = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`;
      const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
      promises.push(
        api.get<TodayScrape[]>(`/scrapes/report?from=${fromStr}&to=${toStr}`).then(setWeekScrapes).catch(() => {})
      );
    }
    if (hasPrivilege('settings.view')) {
      promises.push(
        api.get<{ settings: any; runtime: any }>('/settings/scheduler')
          .then((r) => setScheduler({ settings: r.settings, runtime: r.runtime }))
          .catch(() => {})
      );
    }
    if (hasPrivilege('activity.view')) {
      promises.push(
        api.get<{ items: ActivityEntry[] }>('/activity?limit=8').then((r) => setActivity(r.items)).catch(() => {})
      );
    }

    Promise.all(promises).finally(() => setLoading(false));
  }, [hasPrivilege]);

  const profileCounts = useMemo(() => {
    const total = profiles.length;
    const active = profiles.filter((p) => p.status === 'LOGGED_IN' || p.status === 'SCRAPING').length;
    const idle = profiles.filter((p) => p.status === 'IDLE').length;
    const issues = profiles.filter((p) => ISSUE_STATUSES.includes(p.status)).length;
    const byKind: Record<string, number> = {};
    for (const p of profiles) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
    return { total, active, idle, issues, byKind };
  }, [profiles]);

  const todayTotals = useMemo(() => {
    const t = { dep: 0, wd: 0, depCount: 0, wdCount: 0, newReg: 0, newDep: 0, profiles: 0 };
    for (const s of todayScrapes) {
      t.dep += numVal(s.totalDepositAmount);
      t.wd += numVal(s.totalWithdrawalAmount);
      t.depCount += numVal(s.totalDepositCount);
      t.wdCount += numVal(s.totalWithdrawalCount);
      t.newReg += numVal(s.newRegistrationCount);
      t.newDep += numVal(s.newDepositCount);
      t.profiles++;
    }
    return { ...t, net: t.dep - t.wd };
  }, [todayScrapes]);

  const weekDaily = useMemo(() => {
    const byDate: Record<string, { dep: number; wd: number; reg: number }> = {};
    for (const s of weekScrapes) {
      const d = s.reportDateString;
      if (!byDate[d]) byDate[d] = { dep: 0, wd: 0, reg: 0 };
      byDate[d].dep += numVal(s.totalDepositAmount);
      byDate[d].wd += numVal(s.totalWithdrawalAmount);
      byDate[d].reg += numVal(s.newRegistrationCount);
    }
    return Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  }, [weekScrapes]);

  const profilesWithToday = useMemo(() => {
    const scrapeMap: Record<string, TodayScrape> = {};
    for (const s of todayScrapes) scrapeMap[s.profileId] = s;
    return profiles
      .map((p) => ({ ...p, scrape: scrapeMap[p.id] || null }))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) || a.name.localeCompare(b.name));
  }, [profiles, todayScrapes]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  if (profiles.length === 0 && !hasPrivilege('profiles.view')) {
    return (
      <div className="mt-10 text-center text-muted">
        <p>Welcome to Scraper Dashboard v2.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Row 1: Today's financial KPIs ── */}
      {todayScrapes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Net Flow hero */}
          <div className={`p-4 rounded-sm border ${
            todayTotals.net >= 0
              ? 'bg-[rgba(52,211,153,0.06)] border-[rgba(52,211,153,0.2)]'
              : 'bg-[rgba(239,68,68,0.06)] border-[rgba(239,68,68,0.2)]'
          }`}>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Today Net Flow</div>
            <div className={`text-2xl font-bold mt-0.5 ${todayTotals.net >= 0 ? 'text-success' : 'text-error'}`}>
              {todayTotals.net >= 0 ? '+' : ''}{fmtCompact(todayTotals.net, true)}
            </div>
            {weekDaily.length > 1 && (
              <div className="mt-1.5">
                <Sparkline values={weekDaily.map(([, d]) => d.dep - d.wd)} color={todayTotals.net >= 0 ? '#199e70' : '#e66767'} height={22} />
              </div>
            )}
          </div>

          {/* Deposits */}
          <div className="p-4 rounded-sm bg-surface border border-border">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Deposits</div>
            <div className="text-xl font-bold mt-0.5">{fmtCompact(todayTotals.dep, true)}</div>
            <div className="text-[11px] text-muted mt-0.5">{fmt(todayTotals.depCount)} txns</div>
            {weekDaily.length > 1 && (
              <div className="mt-1"><Sparkline values={weekDaily.map(([, d]) => d.dep)} color="#3987e5" height={20} /></div>
            )}
          </div>

          {/* Withdrawals */}
          <div className="p-4 rounded-sm bg-surface border border-border">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Withdrawals</div>
            <div className="text-xl font-bold mt-0.5">{fmtCompact(todayTotals.wd, true)}</div>
            <div className="text-[11px] text-muted mt-0.5">{fmt(todayTotals.wdCount)} txns</div>
            {weekDaily.length > 1 && (
              <div className="mt-1"><Sparkline values={weekDaily.map(([, d]) => d.wd)} color="#d95926" height={20} /></div>
            )}
          </div>

          {/* New Registrations */}
          <div className="p-4 rounded-sm bg-surface border border-border">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Registrations</div>
            <div className="text-xl font-bold mt-0.5">{fmt(todayTotals.newReg)}</div>
            <div className="text-[11px] text-muted mt-0.5">{fmt(todayTotals.newDep)} new deposits</div>
            {weekDaily.length > 1 && (
              <div className="mt-1"><Sparkline values={weekDaily.map(([, d]) => d.reg)} color="#199e70" height={20} /></div>
            )}
          </div>
        </div>
      )}

      {/* ── Row 2: System health strip ── */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Profile health */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
          {[
            { label: 'Profiles', value: profileCounts.total, cls: '' },
            { label: 'Active', value: profileCounts.active, cls: 'text-success' },
            { label: 'Idle', value: profileCounts.idle, cls: 'text-muted' },
            { label: 'Issues', value: profileCounts.issues, cls: profileCounts.issues > 0 ? 'text-error' : 'text-muted' },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-sm bg-surface border border-border min-w-0">
              <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">{s.label}</div>
              <div className={`text-[22px] font-bold mt-0.5 ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Platform breakdown */}
        {Object.keys(profileCounts.byKind).length > 0 && (
          <div className="p-3 rounded-sm bg-surface border border-border flex flex-col justify-center gap-1 min-w-[120px]">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Platforms</div>
            <div className="flex gap-2">
              {Object.entries(profileCounts.byKind).sort().map(([kind, count]) => (
                <span key={kind} className="flex items-center gap-1">
                  <span className={`badge badge-${kind.toLowerCase()}`}>{kind}</span>
                  <span className="text-[13px] font-semibold">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scheduler status */}
        {scheduler && (
          <div className="p-3 rounded-sm bg-surface border border-border min-w-[180px]">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1">Scheduler</div>
            <div className="flex gap-3 text-xs">
              <div>
                <span className={`font-semibold ${scheduler.settings.fetch.enabled ? 'text-success' : 'text-error'}`}>
                  {scheduler.settings.fetch.enabled ? 'ON' : 'OFF'}
                </span>
                <span className="text-muted ml-1">Fetch</span>
                {scheduler.settings.fetch.enabled && (
                  <span className="text-muted ml-1 text-[11px]">({msToReadable(scheduler.settings.fetch.intervalMs)})</span>
                )}
              </div>
              <div>
                <span className={`font-semibold ${scheduler.settings.refresh.enabled ? 'text-success' : 'text-muted'}`}>
                  {scheduler.settings.refresh.enabled ? 'ON' : 'OFF'}
                </span>
                <span className="text-muted ml-1">Refresh</span>
              </div>
            </div>
            {scheduler.runtime.runningCount > 0 && (
              <div className="mt-1 text-[11px]">
                <span className="status-dot status-scraping mr-1" />
                <span className="text-accent font-semibold">{scheduler.runtime.runningCount} running</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Row 3: Profile table + Activity sidebar ── */}
      <div className={`grid gap-4 ${activity.length > 0 ? 'grid-cols-1 lg:grid-cols-[1fr_320px]' : 'grid-cols-1'}`}>
        {/* Profile status table */}
        {profiles.length > 0 && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold">Profile Status</h3>
              {todayScrapes.length > 0 && (
                <span className="text-[11px] text-muted">
                  {todayTotals.profiles}/{profileCounts.total} scraped today
                </span>
              )}
            </div>
            <div className="table-wrap table-sticky-header">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hidden sm:table-cell">Kind</th>
                    <th>Status</th>
                    {todayScrapes.length > 0 && (
                      <>
                        <th className="text-right hidden md:table-cell">Dep Amt</th>
                        <th className="text-right hidden md:table-cell">WD Amt</th>
                        <th className="text-right">Net</th>
                      </>
                    )}
                    <th className="hidden lg:table-cell">Last Scrape</th>
                  </tr>
                </thead>
                <tbody>
                  {profilesWithToday.map((p) => {
                    const dep = p.scrape ? numVal(p.scrape.totalDepositAmount) : 0;
                    const wd = p.scrape ? numVal(p.scrape.totalWithdrawalAmount) : 0;
                    const net = dep - wd;
                    const isIssue = ISSUE_STATUSES.includes(p.status);
                    return (
                      <tr key={p.id} className={isIssue ? 'bg-[rgba(239,68,68,0.03)]' : ''}>
                        <td className="cell-name">
                          <Link href={`/profiles/${p.id}`}>{p.name}</Link>
                        </td>
                        <td className="hidden sm:table-cell"><span className={`badge badge-${p.kind.toLowerCase()}`}>{p.kind}</span></td>
                        <td>
                          <span className={`status-dot status-${p.status.toLowerCase()}`} />
                          <span className="text-xs">{p.status.replace('_', ' ')}</span>
                        </td>
                        {todayScrapes.length > 0 && (
                          <>
                            <td className="text-right tabular-nums text-xs hidden md:table-cell">
                              {p.scrape ? fmtCompact(dep, true) : <span className="text-muted">—</span>}
                            </td>
                            <td className="text-right tabular-nums text-xs hidden md:table-cell">
                              {p.scrape ? fmtCompact(wd, true) : <span className="text-muted">—</span>}
                            </td>
                            <td className={`text-right tabular-nums text-xs ${p.scrape ? 'font-semibold' : ''} ${
                              p.scrape ? (net >= 0 ? 'text-success' : 'text-error') : 'text-muted'
                            }`}>
                              {p.scrape ? `${net >= 0 ? '+' : ''}${fmtCompact(net, true)}` : '—'}
                            </td>
                          </>
                        )}
                        <td className="cell-muted text-xs whitespace-nowrap hidden lg:table-cell">{formatDate(p.lastScrapeAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {profiles.length === 0 && (
          <section className="card">
            <h3>Welcome to Scraper Dashboard v2</h3>
            <p className="text-muted mt-2">
              No profiles yet. Go to <Link href="/profiles">Profiles</Link> to create one.
            </p>
          </section>
        )}

        {/* Activity feed */}
        {activity.length > 0 && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold">Recent Activity</h3>
              {hasPrivilege('activity.view') && (
                <Link href="/activity" className="text-[11px] text-accent no-underline hover:underline">View all</Link>
              )}
            </div>
            <div className="bg-surface border border-border rounded overflow-hidden">
              {activity.map((a, i) => (
                <div key={a.id} className={`px-3.5 py-2.5 flex flex-col gap-0.5 ${i < activity.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold">{a.action}</span>
                    <span className="text-[10px] text-muted whitespace-nowrap">{timeAgo(a.createdAt)}</span>
                  </div>
                  <div className="text-[11px] text-muted flex gap-1.5 items-center">
                    <span className={`badge badge-actor-${a.actorType.toLowerCase()} text-[9px] px-[5px] py-px`}>{a.actorType}</span>
                    {a.actor?.name && <span>{a.actor.name}</span>}
                    {a.target && <span className="opacity-70">{a.target}</span>}
                  </div>
                  {a.details && (
                    <div className="text-[11px] text-muted opacity-60 overflow-hidden text-ellipsis whitespace-nowrap">
                      {a.details}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

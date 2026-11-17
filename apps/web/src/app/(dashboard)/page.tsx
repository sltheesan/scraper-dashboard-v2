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
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }}>
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

  // --- Computed ---

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
      <div className="empty-state" style={{ marginTop: 40 }}>
        <p>Welcome to Scraper Dashboard v2.</p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Row 1: Today's financial KPIs ── */}
      {todayScrapes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginBottom: 16 }}>
          {/* Net Flow hero */}
          <div style={{
            padding: '14px 18px', borderRadius: 'var(--radius-sm)',
            background: todayTotals.net >= 0 ? 'rgba(52,211,153,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${todayTotals.net >= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Today Net Flow</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: todayTotals.net >= 0 ? 'var(--success)' : 'var(--danger, var(--error))', marginTop: 2 }}>
              {todayTotals.net >= 0 ? '+' : ''}{fmtCompact(todayTotals.net, true)}
            </div>
            {weekDaily.length > 1 && (
              <div style={{ marginTop: 6 }}>
                <Sparkline values={weekDaily.map(([, d]) => d.dep - d.wd)} color={todayTotals.net >= 0 ? '#199e70' : '#e66767'} height={22} />
              </div>
            )}
          </div>

          {/* Deposits */}
          <div style={{ padding: '14px 18px', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Deposits</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{fmtCompact(todayTotals.dep, true)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{fmt(todayTotals.depCount)} txns</div>
            {weekDaily.length > 1 && (
              <div style={{ marginTop: 4 }}><Sparkline values={weekDaily.map(([, d]) => d.dep)} color="#3987e5" height={20} /></div>
            )}
          </div>

          {/* Withdrawals */}
          <div style={{ padding: '14px 18px', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Withdrawals</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{fmtCompact(todayTotals.wd, true)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{fmt(todayTotals.wdCount)} txns</div>
            {weekDaily.length > 1 && (
              <div style={{ marginTop: 4 }}><Sparkline values={weekDaily.map(([, d]) => d.wd)} color="#d95926" height={20} /></div>
            )}
          </div>

          {/* New Registrations */}
          <div style={{ padding: '14px 18px', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Registrations</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{fmt(todayTotals.newReg)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{fmt(todayTotals.newDep)} new deposits</div>
            {weekDaily.length > 1 && (
              <div style={{ marginTop: 4 }}><Sparkline values={weekDaily.map(([, d]) => d.reg)} color="#199e70" height={20} /></div>
            )}
          </div>
        </div>
      )}

      {/* ── Row 2: System health strip ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Profile health */}
        <div style={{ display: 'flex', gap: 10, flex: 1, minWidth: 0 }}>
          {[
            { label: 'Profiles', value: profileCounts.total, color: 'var(--text)' },
            { label: 'Active', value: profileCounts.active, color: 'var(--success)' },
            { label: 'Idle', value: profileCounts.idle, color: 'var(--muted)' },
            { label: 'Issues', value: profileCounts.issues, color: profileCounts.issues > 0 ? 'var(--error)' : 'var(--muted)' },
          ].map((s) => (
            <div key={s.label} style={{
              flex: 1, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)', border: '1px solid var(--border)',
              minWidth: 80,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Platform breakdown */}
        {Object.keys(profileCounts.byKind).length > 0 && (
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, minWidth: 120,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Platforms</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(profileCounts.byKind).sort().map(([kind, count]) => (
                <span key={kind} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className={`badge badge-${kind.toLowerCase()}`}>{kind}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scheduler status */}
        {scheduler && (
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            minWidth: 180,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Scheduler</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
              <div>
                <span style={{ color: scheduler.settings.fetch.enabled ? 'var(--success)' : 'var(--error)', fontWeight: 600 }}>
                  {scheduler.settings.fetch.enabled ? 'ON' : 'OFF'}
                </span>
                <span style={{ color: 'var(--muted)', marginLeft: 4 }}>Fetch</span>
                {scheduler.settings.fetch.enabled && (
                  <span style={{ color: 'var(--muted)', marginLeft: 4, fontSize: 11 }}>({msToReadable(scheduler.settings.fetch.intervalMs)})</span>
                )}
              </div>
              <div>
                <span style={{ color: scheduler.settings.refresh.enabled ? 'var(--success)' : 'var(--muted)', fontWeight: 600 }}>
                  {scheduler.settings.refresh.enabled ? 'ON' : 'OFF'}
                </span>
                <span style={{ color: 'var(--muted)', marginLeft: 4 }}>Refresh</span>
              </div>
            </div>
            {scheduler.runtime.runningCount > 0 && (
              <div style={{ marginTop: 4, fontSize: 11 }}>
                <span className="status-dot status-scraping" style={{ marginRight: 4 }} />
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{scheduler.runtime.runningCount} running</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Row 3: Profile table + Activity sidebar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: activity.length > 0 ? '1fr 320px' : '1fr', gap: 16 }}>
        {/* Profile status table */}
        {profiles.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Profile Status</h3>
              {todayScrapes.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {todayTotals.profiles}/{profileCounts.total} scraped today
                </span>
              )}
            </div>
            <div className="table-wrap table-sticky-header">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Status</th>
                    {todayScrapes.length > 0 && (
                      <>
                        <th style={{ textAlign: 'right' }}>Dep Amt</th>
                        <th style={{ textAlign: 'right' }}>WD Amt</th>
                        <th style={{ textAlign: 'right' }}>Net</th>
                      </>
                    )}
                    <th>Last Scrape</th>
                  </tr>
                </thead>
                <tbody>
                  {profilesWithToday.map((p) => {
                    const dep = p.scrape ? numVal(p.scrape.totalDepositAmount) : 0;
                    const wd = p.scrape ? numVal(p.scrape.totalWithdrawalAmount) : 0;
                    const net = dep - wd;
                    const isIssue = ISSUE_STATUSES.includes(p.status);
                    return (
                      <tr key={p.id} style={isIssue ? { background: 'rgba(239,68,68,0.03)' } : undefined}>
                        <td className="cell-name">
                          <Link href={`/profiles/${p.id}`}>{p.name}</Link>
                        </td>
                        <td><span className={`badge badge-${p.kind.toLowerCase()}`}>{p.kind}</span></td>
                        <td>
                          <span className={`status-dot status-${p.status.toLowerCase()}`} />
                          <span style={{ fontSize: 12 }}>{p.status.replace('_', ' ')}</span>
                        </td>
                        {todayScrapes.length > 0 && (
                          <>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                              {p.scrape ? fmtCompact(dep, true) : <span style={{ color: 'var(--muted)' }}>—</span>}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                              {p.scrape ? fmtCompact(wd, true) : <span style={{ color: 'var(--muted)' }}>—</span>}
                            </td>
                            <td style={{
                              textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12,
                              fontWeight: p.scrape ? 600 : 400,
                              color: p.scrape ? (net >= 0 ? 'var(--success)' : 'var(--error)') : 'var(--muted)',
                            }}>
                              {p.scrape ? `${net >= 0 ? '+' : ''}${fmtCompact(net, true)}` : '—'}
                            </td>
                          </>
                        )}
                        <td className="cell-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(p.lastScrapeAt)}</td>
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
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>
              No profiles yet. Go to <Link href="/profiles">Profiles</Link> to create one.
            </p>
          </section>
        )}

        {/* Activity feed */}
        {activity.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Recent Activity</h3>
              {hasPrivilege('activity.view') && (
                <Link href="/activity" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>View all</Link>
              )}
            </div>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}>
              {activity.map((a, i) => (
                <div key={a.id} style={{
                  padding: '10px 14px',
                  borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{a.action}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{timeAgo(a.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge badge-actor-${a.actorType.toLowerCase()}`} style={{ fontSize: 9, padding: '1px 5px' }}>{a.actorType}</span>
                    {a.actor?.name && <span>{a.actor.name}</span>}
                    {a.target && <span style={{ opacity: 0.7 }}>{a.target}</span>}
                  </div>
                  {a.details && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

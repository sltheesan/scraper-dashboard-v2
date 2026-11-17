'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Profile {
  id: string;
  name: string;
  kind: string;
}

interface ScrapeRow {
  id: string;
  profileId: string;
  kind: string;
  reportDate: string;
  reportDateString: string;
  newRegistrationCount: number | null;
  newDepositCount: number | null;
  totalDepositCount: number | null;
  totalDepositAmount: string | null;
  totalWithdrawalCount: number | null;
  totalWithdrawalAmount: string | null;
  profile: { name: string; kind: string };
}

type MetricKey = 'newRegistrationCount' | 'newDepositCount' | 'totalDepositCount' | 'totalDepositAmount' | 'totalWithdrawalCount' | 'totalWithdrawalAmount';

const METRICS: { key: MetricKey; label: string; isAmount: boolean }[] = [
  { key: 'newRegistrationCount', label: 'New Reg', isAmount: false },
  { key: 'newDepositCount', label: 'New Dep', isAmount: false },
  { key: 'totalDepositCount', label: 'Total Dep #', isAmount: false },
  { key: 'totalDepositAmount', label: 'Total Dep Amt', isAmount: true },
  { key: 'totalWithdrawalCount', label: 'Total WD #', isAmount: false },
  { key: 'totalWithdrawalAmount', label: 'Total WD Amt', isAmount: true },
];

function formatNum(v: number | string | null | undefined, isAmount = false): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return isAmount ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString('en-US');
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

type ViewMode = 'table' | 'summary' | 'comparison';

export default function ReportsPage() {
  const { hasPrivilege } = useAuth();
  const router = useRouter();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [data, setData] = useState<ScrapeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState(false);

  // Filters
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<string>('ALL');
  const [dateMode, setDateMode] = useState<'single' | 'range'>('range');
  const [singleDate, setSingleDate] = useState(toDateStr(new Date()));
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toDateStr(d);
  });
  const [dateTo, setDateTo] = useState(toDateStr(new Date()));

  // View
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [profileSearch, setProfileSearch] = useState('');

  useEffect(() => {
    if (!hasPrivilege('reports.view')) {
      router.replace('/');
      return;
    }
    api.get<Profile[]>('/profiles').then(setProfiles).catch(() => {});
  }, [hasPrivilege, router]);

  const filteredProfiles = useMemo(() => {
    let list = profiles;
    if (kindFilter !== 'ALL') list = list.filter((p) => p.kind === kindFilter);
    if (profileSearch) list = list.filter((p) => p.name.toLowerCase().includes(profileSearch.toLowerCase()));
    return list;
  }, [profiles, kindFilter, profileSearch]);

  const kinds = useMemo(() => [...new Set(profiles.map((p) => p.kind))].sort(), [profiles]);

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const ids = selectedProfiles.length > 0 ? selectedProfiles : filteredProfiles.map((p) => p.id);
      if (ids.length > 0 && ids.length < profiles.length) params.set('profileIds', ids.join(','));
      if (kindFilter !== 'ALL') params.set('kind', kindFilter);
      if (dateMode === 'single') {
        params.set('from', singleDate);
        params.set('to', singleDate);
      } else {
        params.set('from', dateFrom);
        params.set('to', dateTo);
      }
      const rows = await api.get<ScrapeRow[]>(`/scrapes/report?${params}`);
      setData(rows);
      setGenerated(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleProfile(id: string) {
    setSelectedProfiles((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllProfiles() {
    setSelectedProfiles(filteredProfiles.map((p) => p.id));
  }

  function clearProfiles() {
    setSelectedProfiles([]);
  }

  // Aggregated summary data
  const summary = useMemo(() => {
    if (!data.length) return null;
    const byProfile: Record<string, { name: string; kind: string; rows: ScrapeRow[] }> = {};
    for (const row of data) {
      if (!byProfile[row.profileId]) byProfile[row.profileId] = { name: row.profile.name, kind: row.profile.kind, rows: [] };
      byProfile[row.profileId].rows.push(row);
    }

    const profileSummaries = Object.entries(byProfile).map(([pid, { name, kind, rows }]) => {
      const totals: Record<string, number> = {};
      for (const m of METRICS) {
        totals[m.key] = rows.reduce((sum, r) => {
          const v = r[m.key];
          return sum + (v !== null && v !== undefined ? (typeof v === 'string' ? parseFloat(v) : v) : 0);
        }, 0);
      }
      return { profileId: pid, name, kind, days: rows.length, totals };
    });

    const grandTotals: Record<string, number> = {};
    for (const m of METRICS) {
      grandTotals[m.key] = profileSummaries.reduce((sum, ps) => sum + (ps.totals[m.key] || 0), 0);
    }

    return { profileSummaries, grandTotals, totalDays: new Set(data.map((r) => r.reportDateString)).size };
  }, [data]);

  // Comparison: side-by-side profiles for a date range
  const comparisonData = useMemo(() => {
    if (!data.length) return [];
    const byProfile: Record<string, { name: string; kind: string; totals: Record<string, number> }> = {};
    for (const row of data) {
      if (!byProfile[row.profileId]) {
        byProfile[row.profileId] = { name: row.profile.name, kind: row.profile.kind, totals: {} };
        for (const m of METRICS) byProfile[row.profileId].totals[m.key] = 0;
      }
      for (const m of METRICS) {
        const v = row[m.key];
        byProfile[row.profileId].totals[m.key] += v !== null && v !== undefined ? (typeof v === 'string' ? parseFloat(v) : v) : 0;
      }
    }
    return Object.values(byProfile).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  function exportCSV() {
    if (!data.length) return;
    const header = ['Date', 'Profile', 'Kind', ...METRICS.map((m) => m.label)];
    const rows = data.map((r) => [
      r.reportDateString,
      r.profile.name,
      r.profile.kind,
      ...METRICS.map((m) => {
        const v = r[m.key];
        return v !== null && v !== undefined ? String(v) : '';
      }),
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${dateMode === 'single' ? singleDate : `${dateFrom}_to_${dateTo}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!hasPrivilege('reports.view')) return null;

  return (
    <div>
      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Kind filter */}
          <div style={{ minWidth: 140 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
              Platform
            </label>
            <select
              className="form-input"
              value={kindFilter}
              onChange={(e) => { setKindFilter(e.target.value); setSelectedProfiles([]); }}
              style={{ width: '100%' }}
            >
              <option value="ALL">All Platforms</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          {/* Date mode */}
          <div style={{ minWidth: 130 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
              Date Type
            </label>
            <select
              className="form-input"
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value as 'single' | 'range')}
              style={{ width: '100%' }}
            >
              <option value="single">Single Date</option>
              <option value="range">Date Range</option>
            </select>
          </div>

          {/* Date inputs */}
          {dateMode === 'single' ? (
            <div style={{ minWidth: 160 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                Date
              </label>
              <input
                type="date"
                className="form-input"
                value={singleDate}
                onChange={(e) => setSingleDate(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <>
              <div style={{ minWidth: 160 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                  From
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ minWidth: 160 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                  To
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {/* Quick presets */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
              Quick
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { label: 'Today', fn: () => { setDateMode('single'); setSingleDate(toDateStr(new Date())); } },
                { label: 'Yesterday', fn: () => { setDateMode('single'); const d = new Date(); d.setDate(d.getDate() - 1); setSingleDate(toDateStr(d)); } },
                { label: '7d', fn: () => { setDateMode('range'); const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); } },
                { label: '30d', fn: () => { setDateMode('range'); const d = new Date(); d.setDate(d.getDate() - 29); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); } },
                { label: 'This Month', fn: () => { setDateMode('range'); const now = new Date(); setDateFrom(toDateStr(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(toDateStr(now)); } },
                { label: 'Last Month', fn: () => { setDateMode('range'); const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - 1, 1); const end = new Date(now.getFullYear(), now.getMonth(), 0); setDateFrom(toDateStr(start)); setDateTo(toDateStr(end)); } },
              ].map((p) => (
                <button key={p.label} type="button" onClick={p.fn} style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--muted)',
                  fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" onClick={generate} disabled={loading} style={{ height: 38 }}>
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>

        {/* Profile selector */}
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Profiles
              {selectedProfiles.length > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 700 }}>
                  {selectedProfiles.length} selected
                </span>
              )}
              {selectedProfiles.length === 0 && (
                <span style={{ marginLeft: 8, opacity: 0.6 }}>All (click to filter)</span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search…"
                value={profileSearch}
                onChange={(e) => setProfileSearch(e.target.value)}
                className="form-input"
                style={{ width: 140, height: 28, fontSize: 12, padding: '0 8px' }}
              />
              <button type="button" onClick={selectAllProfiles} style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--muted)',
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
              }}>All</button>
              <button type="button" onClick={clearProfiles} style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--muted)',
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
              }}>Clear</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {filteredProfiles.map((p) => {
              const sel = selectedProfiles.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProfile(p.id)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: sel ? 600 : 400,
                    border: sel ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: sel ? 'rgba(79, 140, 255, 0.1)' : 'transparent',
                    color: sel ? 'var(--accent)' : 'var(--muted)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                >
                  {p.name}
                  <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.6 }}>{p.kind}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results */}
      {generated && (
        <>
          {/* View mode + export */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="tabs">
              {([
                { key: 'table' as ViewMode, label: 'Detail Table' },
                { key: 'summary' as ViewMode, label: 'Summary' },
                { key: 'comparison' as ViewMode, label: 'Comparison' },
              ]).map((t) => (
                <button key={t.key} className={`tab ${viewMode === t.key ? 'tab-active' : ''}`} onClick={() => setViewMode(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {data.length} record{data.length !== 1 ? 's' : ''}
              </span>
              <button type="button" onClick={exportCSV} disabled={!data.length} style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--text)',
                fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
              }}>
                Export CSV
              </button>
            </div>
          </div>

          {data.length === 0 ? (
            <div className="empty-state"><p>No data found for the selected filters.</p></div>
          ) : viewMode === 'table' ? (
            /* Detail Table */
            <div className="table-wrap table-sticky-header">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Profile</th>
                    <th>Kind</th>
                    {METRICS.map((m) => <th key={m.key} style={{ textAlign: 'right' }}>{m.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-muted" style={{ whiteSpace: 'nowrap' }}>{formatDisplayDate(r.reportDate)}</td>
                      <td className="cell-name">{r.profile.name}</td>
                      <td>
                        <span className={`badge ${r.profile.kind === 'CGAMING' ? 'badge-success' : 'badge-info'}`}>
                          {r.profile.kind}
                        </span>
                      </td>
                      {METRICS.map((m) => (
                        <td key={m.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatNum(r[m.key], m.isAmount)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : viewMode === 'summary' ? (
            /* Summary view */
            <div>
              {summary && (
                <>
                  {/* Grand totals */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {METRICS.map((m) => (
                      <div key={m.key} className="card" style={{ padding: '14px 18px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                          {m.label}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {formatNum(summary.grandTotals[m.key], m.isAmount)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                    {summary.profileSummaries.length} profile{summary.profileSummaries.length !== 1 ? 's' : ''} across {summary.totalDays} day{summary.totalDays !== 1 ? 's' : ''}
                  </div>

                  {/* Per-profile breakdown */}
                  <div className="table-wrap table-sticky-header">
                    <table>
                      <thead>
                        <tr>
                          <th>Profile</th>
                          <th>Kind</th>
                          <th style={{ textAlign: 'center' }}>Days</th>
                          {METRICS.map((m) => <th key={m.key} style={{ textAlign: 'right' }}>{m.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {summary.profileSummaries.sort((a, b) => a.name.localeCompare(b.name)).map((ps) => (
                          <tr key={ps.profileId}>
                            <td className="cell-name">{ps.name}</td>
                            <td>
                              <span className={`badge ${ps.kind === 'CGAMING' ? 'badge-success' : 'badge-info'}`}>
                                {ps.kind}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>{ps.days}</td>
                            {METRICS.map((m) => (
                              <td key={m.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {formatNum(ps.totals[m.key], m.isAmount)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 700 }}>
                          <td>Total</td>
                          <td></td>
                          <td style={{ textAlign: 'center' }}>{summary.totalDays}</td>
                          {METRICS.map((m) => (
                            <td key={m.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {formatNum(summary.grandTotals[m.key], m.isAmount)}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Comparison view */
            <div>
              <div className="table-wrap table-sticky-header">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>#</th>
                      <th>Profile</th>
                      <th>Kind</th>
                      {METRICS.map((m) => <th key={m.key} style={{ textAlign: 'right' }}>{m.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonData.map((p, idx) => {
                      const best: Record<string, boolean> = {};
                      for (const m of METRICS) {
                        const max = Math.max(...comparisonData.map((c) => c.totals[m.key] || 0));
                        best[m.key] = (p.totals[m.key] || 0) === max && max > 0;
                      }
                      return (
                        <tr key={p.name}>
                          <td className="cell-muted">{idx + 1}</td>
                          <td className="cell-name">{p.name}</td>
                          <td>
                            <span className={`badge ${p.kind === 'CGAMING' ? 'badge-success' : 'badge-info'}`}>
                              {p.kind}
                            </span>
                          </td>
                          {METRICS.map((m) => (
                            <td key={m.key} style={{
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: best[m.key] ? 700 : 400,
                              color: best[m.key] ? 'var(--success)' : undefined,
                            }}>
                              {formatNum(p.totals[m.key], m.isAmount)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Features info */}
      {!generated && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {[
            { title: 'Detail Table', desc: 'View all scrape data row by row with date, profile, and all 6 metrics.' },
            { title: 'Summary View', desc: 'Aggregated totals per profile and grand totals across the selected date range.' },
            { title: 'Profile Comparison', desc: 'Side-by-side comparison of all profiles with top performers highlighted.' },
            { title: 'CSV Export', desc: 'Download the full report data as a CSV file for use in spreadsheets.' },
            { title: 'Quick Date Presets', desc: 'One-click buttons for Today, Yesterday, 7 days, 30 days, This Month, Last Month.' },
            { title: 'Multi-Profile Filter', desc: 'Select specific profiles or filter by platform type (CGAMING / ZOOMWLB).' },
          ].map((f) => (
            <div key={f.title} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

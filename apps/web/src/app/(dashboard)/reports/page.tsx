'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Profile { id: string; name: string; kind: string }

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

const METRICS: { key: MetricKey; label: string; short: string; isAmount: boolean }[] = [
  { key: 'newRegistrationCount', label: 'New Registrations', short: 'New Reg', isAmount: false },
  { key: 'newDepositCount', label: 'New Deposits', short: 'New Dep', isAmount: false },
  { key: 'totalDepositCount', label: 'Total Deposit Count', short: 'Dep #', isAmount: false },
  { key: 'totalDepositAmount', label: 'Total Deposit Amount', short: 'Dep Amt', isAmount: true },
  { key: 'totalWithdrawalCount', label: 'Total Withdrawal Count', short: 'WD #', isAmount: false },
  { key: 'totalWithdrawalAmount', label: 'Total Withdrawal Amount', short: 'WD Amt', isAmount: true },
];

function numVal(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function fmt(v: number | string | null | undefined, isAmount = false): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return isAmount ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString('en-US');
}

function fmtCompact(n: number, isAmount = false): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return isAmount ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString('en-US');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

type ViewMode = 'charts' | 'table' | 'profiles';

// Validated CVD-safe palette (see palette.md)
const COLORS_DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const COLORS_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

function useTheme(): 'dark' | 'light' {
  const [t, setT] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const check = () => setT(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return t;
}

// --- Chart components ---

function Sparkline({ values, color, height = 32 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return null;
  const W = 120, H = height;
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

function TrendLine({ series, dates, theme, height = 240 }: {
  series: { label: string; values: number[]; color: string }[];
  dates: string[];
  theme: 'dark' | 'light';
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 700, H = height, PL = 65, PR = 16, PT = 16, PB = 36;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const textCol = theme === 'dark' ? '#898781' : '#898781';
  const gridCol = theme === 'dark' ? '#2c2c2a' : '#e1e0d9';
  const baseCol = theme === 'dark' ? '#383835' : '#c3c2b7';
  const surfaceCol = theme === 'dark' ? '#0f1115' : '#f4f5f7';

  const allVals = series.flatMap((s) => s.values);
  const rawMax = Math.max(...allVals, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil(rawMax / mag) * mag || 1;
  const ticks = Array.from({ length: 5 }, (_, i) => (niceMax / 4) * i);

  function px(i: number) { return PL + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW); }
  function py(v: number) { return PT + plotH - (v / niceMax) * plotH; }

  const handleMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || dates.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < dates.length; i++) {
      const d = Math.abs(sx - px(i));
      if (d < bestD) { bestD = d; best = i; }
    }
    setHoverIdx(best);
  }, [dates]);

  if (dates.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20 }}>No data</div>;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={PL + plotW} y1={py(t)} y2={py(t)} stroke={gridCol} strokeWidth={1} />
            <text x={PL - 8} y={py(t) + 4} textAnchor="end" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">
              {t >= 1000 ? `${(t / 1000).toLocaleString('en-US')}K` : t.toLocaleString('en-US')}
            </text>
          </g>
        ))}
        <line x1={PL} x2={PL + plotW} y1={PT + plotH} y2={PT + plotH} stroke={baseCol} strokeWidth={1} />

        {series.map((s) => {
          const path = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(v)}`).join(' ');
          const area = path + ` L${px(s.values.length - 1)},${PT + plotH} L${px(0)},${PT + plotH} Z`;
          return (
            <g key={s.label}>
              <path d={area} fill={s.color} opacity={0.06} />
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {s.values.length <= 31 && s.values.map((v, i) => (
                <circle key={i} cx={px(i)} cy={py(v)} r={dates.length <= 14 ? 3.5 : 2} fill={s.color} stroke={surfaceCol} strokeWidth={1.5} />
              ))}
            </g>
          );
        })}

        {/* X labels */}
        {dates.filter((_, i) => {
          if (dates.length <= 12) return true;
          const step = Math.ceil(dates.length / 8);
          return i % step === 0 || i === dates.length - 1;
        }).map((d, _, arr) => (
          <text key={d} x={px(dates.indexOf(d))} y={PT + plotH + 18} textAnchor="middle" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">
            {d.slice(5)}
          </text>
        ))}

        {/* Legend */}
        {series.length > 1 && series.map((s, i) => (
          <g key={s.label} transform={`translate(${PL + i * 110}, ${H - 4})`}>
            <line x1={0} x2={16} y1={0} y2={0} stroke={s.color} strokeWidth={2} strokeLinecap="round" />
            <text x={20} y={4} fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">{s.label}</text>
          </g>
        ))}

        {/* Crosshair */}
        {hoverIdx !== null && (
          <>
            <line x1={px(hoverIdx)} x2={px(hoverIdx)} y1={PT} y2={PT + plotH} stroke={textCol} strokeWidth={1} opacity={0.25} />
            {series.map((s) => (
              <circle key={s.label} cx={px(hoverIdx)} cy={py(s.values[hoverIdx])} r={5} fill={s.color} stroke={surfaceCol} strokeWidth={2} />
            ))}
          </>
        )}
      </svg>
      {hoverIdx !== null && (
        <div style={{
          position: 'absolute', left: `${(px(hoverIdx) / W) * 100}%`, top: 0, transform: 'translateX(-50%)',
          background: theme === 'dark' ? '#181b22' : '#ffffff', border: `1px solid ${theme === 'dark' ? '#383835' : '#e1e0d9'}`,
          borderRadius: 6, padding: '8px 12px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 11, color: textCol, marginBottom: 4 }}>{dates[hoverIdx]}</div>
          {series.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: textCol }}>{s.label}</span>
              <span style={{ fontWeight: 600 }}>{fmt(s.values[hoverIdx], s.label.includes('Amt'))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HBar({ rows, theme, color }: {
  rows: { label: string; value: number; isAmount?: boolean }[];
  theme: 'dark' | 'light';
  color: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.value), 1);
  const textCol = theme === 'dark' ? '#c3c2b7' : '#52514e';
  const gridCol = theme === 'dark' ? '#2c2c2a' : '#e1e0d9';
  const barH = 20, gap = 3, PL = 95, PR = 70, PT = 4;
  const W = 500, plotW = W - PL - PR;
  const totalH = PT + rows.length * (barH + gap) + 4;

  return (
    <svg viewBox={`0 0 ${W} ${totalH}`} style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 500 }}>
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={PL + f * plotW} x2={PL + f * plotW} y1={PT} y2={totalH - 4} stroke={gridCol} strokeWidth={1} />
      ))}
      {rows.map((r, i) => {
        const y = PT + i * (barH + gap);
        const w = Math.max((r.value / max) * plotW, 0);
        const isH = hovered === i;
        return (
          <g key={r.label} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
            <rect x={0} y={y} width={W} height={barH} fill="transparent" />
            <text x={PL - 6} y={y + barH / 2 + 4} textAnchor="end" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif" opacity={isH ? 1 : 0.7}>
              {r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label}
            </text>
            <rect x={PL} y={y + 1} width={w} height={barH - 2} rx={3} fill={color} opacity={isH ? 1 : 0.75} />
            <text x={PL + w + 5} y={y + barH / 2 + 4} fill={textCol} fontSize={10} fontWeight={600} fontFamily="system-ui,sans-serif">
              {fmtCompact(r.value, r.isAmount)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// --- Main page ---

export default function ReportsPage() {
  const { hasPrivilege } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const colors = theme === 'dark' ? COLORS_DARK : COLORS_LIGHT;

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [data, setData] = useState<ScrapeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState(false);

  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<string>('ALL');
  const [dateMode, setDateMode] = useState<'single' | 'range'>('range');
  const [singleDate, setSingleDate] = useState(toDateStr(new Date()));
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return toDateStr(d); });
  const [dateTo, setDateTo] = useState(toDateStr(new Date()));

  const [viewMode, setViewMode] = useState<ViewMode>('charts');
  const [chartMetric, setChartMetric] = useState<MetricKey>('totalDepositAmount');
  const [profileSearch, setProfileSearch] = useState('');
  const [showProfilePicker, setShowProfilePicker] = useState(false);

  useEffect(() => {
    if (!hasPrivilege('reports.view')) { router.replace('/'); return; }
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
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      const ids = selectedProfiles.length > 0 ? selectedProfiles : filteredProfiles.map((p) => p.id);
      if (ids.length > 0 && ids.length < profiles.length) params.set('profileIds', ids.join(','));
      if (kindFilter !== 'ALL') params.set('kind', kindFilter);
      if (dateMode === 'single') { params.set('from', singleDate); params.set('to', singleDate); }
      else { params.set('from', dateFrom); params.set('to', dateTo); }
      setData(await api.get<ScrapeRow[]>(`/scrapes/report?${params}`));
      setGenerated(true);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // --- Computed analytics ---

  const dailyAgg = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    for (const r of data) {
      const d = r.reportDateString;
      if (!byDate[d]) byDate[d] = {};
      for (const m of METRICS) byDate[d][m.key] = (byDate[d][m.key] || 0) + numVal(r[m.key]);
    }
    const sorted = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
    return { dates: sorted.map(([d]) => d), rows: sorted.map(([, v]) => v) };
  }, [data]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const m of METRICS) t[m.key] = dailyAgg.rows.reduce((s, r) => s + (r[m.key] || 0), 0);
    return t;
  }, [dailyAgg]);

  const netFlow = totals.totalDepositAmount - totals.totalWithdrawalAmount;
  const dayCount = dailyAgg.dates.length || 1;

  const profileTotals = useMemo(() => {
    const byP: Record<string, { name: string; kind: string; t: Record<string, number>; days: number }> = {};
    for (const r of data) {
      if (!byP[r.profileId]) { byP[r.profileId] = { name: r.profile.name, kind: r.profile.kind, t: {}, days: 0 }; for (const m of METRICS) byP[r.profileId].t[m.key] = 0; }
      for (const m of METRICS) byP[r.profileId].t[m.key] += numVal(r[m.key]);
      byP[r.profileId].days++;
    }
    return Object.entries(byP).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  function exportCSV() {
    if (!data.length) return;
    const header = ['Date', 'Profile', 'Kind', ...METRICS.map((m) => m.label)];
    const rows = data.map((r) => [r.reportDateString, r.profile.name, r.profile.kind, ...METRICS.map((m) => { const v = r[m.key]; return v !== null && v !== undefined ? String(v) : ''; })]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `report_${dateMode === 'single' ? singleDate : `${dateFrom}_to_${dateTo}`}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (!hasPrivilege('reports.view')) return null;

  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 };
  const presetBtn: React.CSSProperties = { background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' };

  return (
    <div>
      {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

      {/* ── Filter bar ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 120 }}>
            <label style={labelStyle}>Platform</label>
            <select className="form-input" value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setSelectedProfiles([]); }} style={{ width: '100%', height: 34 }}>
              <option value="ALL">All</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label style={labelStyle}>Date</label>
            <select className="form-input" value={dateMode} onChange={(e) => setDateMode(e.target.value as any)} style={{ width: '100%', height: 34 }}>
              <option value="range">Range</option>
              <option value="single">Single</option>
            </select>
          </div>
          {dateMode === 'single' ? (
            <div style={{ minWidth: 150 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" className="form-input" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} style={{ width: '100%', height: 34 }} />
            </div>
          ) : (
            <>
              <div style={{ minWidth: 150 }}>
                <label style={labelStyle}>From</label>
                <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: '100%', height: 34 }} />
              </div>
              <div style={{ minWidth: 150 }}>
                <label style={labelStyle}>To</label>
                <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: '100%', height: 34 }} />
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 3, alignSelf: 'flex-end' }}>
            {[
              { l: 'Today', fn: () => { setDateMode('single'); setSingleDate(toDateStr(new Date())); } },
              { l: 'Yest', fn: () => { setDateMode('single'); const d = new Date(); d.setDate(d.getDate() - 1); setSingleDate(toDateStr(d)); } },
              { l: '7d', fn: () => { setDateMode('range'); const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); } },
              { l: '30d', fn: () => { setDateMode('range'); const d = new Date(); d.setDate(d.getDate() - 29); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); } },
              { l: 'MTD', fn: () => { setDateMode('range'); const n = new Date(); setDateFrom(toDateStr(new Date(n.getFullYear(), n.getMonth(), 1))); setDateTo(toDateStr(n)); } },
              { l: 'Last Mo', fn: () => { setDateMode('range'); const n = new Date(); setDateFrom(toDateStr(new Date(n.getFullYear(), n.getMonth() - 1, 1))); setDateTo(toDateStr(new Date(n.getFullYear(), n.getMonth(), 0))); } },
            ].map((p) => <button key={p.l} type="button" onClick={p.fn} style={presetBtn}>{p.l}</button>)}
          </div>
          <button type="button" onClick={() => setShowProfilePicker(!showProfilePicker)} style={{ ...presetBtn, color: selectedProfiles.length > 0 ? 'var(--accent)' : 'var(--muted)' }}>
            {selectedProfiles.length > 0 ? `${selectedProfiles.length} profiles` : 'All profiles'}
          </button>
          <button className="btn btn-primary" onClick={generate} disabled={loading} style={{ height: 34, padding: '0 20px' }}>
            {loading ? 'Loading…' : 'Generate'}
          </button>
        </div>

        {/* Profile picker (collapsed) */}
        {showProfilePicker && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <input type="text" placeholder="Search profiles…" value={profileSearch} onChange={(e) => setProfileSearch(e.target.value)} className="form-input" style={{ width: 160, height: 26, fontSize: 11, padding: '0 8px' }} />
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => setSelectedProfiles(filteredProfiles.map((p) => p.id))} style={{ ...presetBtn, fontSize: 10, padding: '2px 8px' }}>All</button>
                <button type="button" onClick={() => setSelectedProfiles([])} style={{ ...presetBtn, fontSize: 10, padding: '2px 8px' }}>Clear</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {filteredProfiles.map((p) => {
                const sel = selectedProfiles.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => setSelectedProfiles((prev) => sel ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: sel ? 600 : 400, border: sel ? '1px solid var(--accent)' : '1px solid var(--border)', background: sel ? 'rgba(79,140,255,0.1)' : 'transparent', color: sel ? 'var(--accent)' : 'var(--muted)', borderRadius: 3, cursor: 'pointer' }}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {generated && data.length > 0 && (
        <>
          {/* KPI strip — always visible */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            {/* Net Flow — hero */}
            <div style={{
              gridColumn: 'span 1', padding: '12px 16px', borderRadius: 'var(--radius-sm)',
              background: netFlow >= 0 ? 'rgba(52,211,153,0.06)' : 'rgba(239,68,68,0.06)',
              border: `1px solid ${netFlow >= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Net Flow</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: netFlow >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 2 }}>
                {netFlow >= 0 ? '+' : ''}{fmtCompact(netFlow, true)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {fmtCompact(netFlow / dayCount, true)}/day avg
              </div>
            </div>

            {METRICS.map((m) => {
              const total = totals[m.key];
              const avg = total / dayCount;
              const vals = dailyAgg.rows.map((r) => r[m.key] || 0);
              const isWd = m.key.includes('Withdrawal');
              const sparkColor = isWd ? colors[1] : colors[0];
              return (
                <div key={m.key} style={{
                  padding: '12px 16px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  cursor: 'pointer', opacity: chartMetric === m.key ? 1 : 0.85,
                  outline: chartMetric === m.key ? '2px solid var(--accent)' : 'none',
                  outlineOffset: -1,
                }} onClick={() => setChartMetric(m.key)}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.short}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{fmtCompact(total, m.isAmount)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{fmtCompact(avg, m.isAmount)}/day</div>
                  <div style={{ marginTop: 6 }}>
                    <Sparkline values={vals} color={sparkColor} height={24} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tabs + export */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="tabs">
              {([
                { key: 'charts' as ViewMode, label: 'Charts' },
                { key: 'profiles' as ViewMode, label: 'Profiles' },
                { key: 'table' as ViewMode, label: 'Detail' },
              ]).map((t) => (
                <button key={t.key} className={`tab ${viewMode === t.key ? 'tab-active' : ''}`} onClick={() => setViewMode(t.key)}>{t.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{data.length} records · {profileTotals.length} profiles · {dayCount} days</span>
              <button type="button" onClick={exportCSV} style={{ ...presetBtn, fontWeight: 600 }}>CSV</button>
            </div>
          </div>

          {/* ── Charts tab ── */}
          {viewMode === 'charts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Deposit vs Withdrawal trend */}
              <div className="card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Deposit vs Withdrawal</div>
                <TrendLine
                  dates={dailyAgg.dates}
                  series={[
                    { label: 'Deposit Amt', values: dailyAgg.rows.map((r) => r.totalDepositAmount || 0), color: colors[0] },
                    { label: 'Withdrawal Amt', values: dailyAgg.rows.map((r) => r.totalWithdrawalAmount || 0), color: colors[1] },
                  ]}
                  theme={theme}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
                {/* Selected metric trend */}
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    {METRICS.find((m) => m.key === chartMetric)?.label} — Daily
                  </div>
                  <TrendLine
                    dates={dailyAgg.dates}
                    series={[{
                      label: METRICS.find((m) => m.key === chartMetric)!.short,
                      values: dailyAgg.rows.map((r) => r[chartMetric] || 0),
                      color: chartMetric.includes('Withdrawal') ? colors[1] : colors[0],
                    }]}
                    theme={theme}
                    height={200}
                  />
                </div>

                {/* Top profiles bar */}
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    Top Profiles — {METRICS.find((m) => m.key === chartMetric)?.short}
                  </div>
                  <HBar
                    rows={profileTotals.map((p) => ({ label: p.name, value: p.t[chartMetric] || 0, isAmount: METRICS.find((m) => m.key === chartMetric)?.isAmount })).sort((a, b) => b.value - a.value).slice(0, 12)}
                    theme={theme}
                    color={chartMetric.includes('Withdrawal') ? colors[1] : colors[0]}
                  />
                </div>
              </div>

              {/* Deposit vs Withdrawal counts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Registrations + New Deposits</div>
                  <TrendLine dates={dailyAgg.dates} series={[
                    { label: 'New Reg', values: dailyAgg.rows.map((r) => r.newRegistrationCount || 0), color: colors[2] },
                    { label: 'New Dep', values: dailyAgg.rows.map((r) => r.newDepositCount || 0), color: colors[0] },
                  ]} theme={theme} height={180} />
                </div>
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Deposit vs Withdrawal Count</div>
                  <TrendLine dates={dailyAgg.dates} series={[
                    { label: 'Dep #', values: dailyAgg.rows.map((r) => r.totalDepositCount || 0), color: colors[0] },
                    { label: 'WD #', values: dailyAgg.rows.map((r) => r.totalWithdrawalCount || 0), color: colors[1] },
                  ]} theme={theme} height={180} />
                </div>
              </div>
            </div>
          )}

          {/* ── Profiles tab ── */}
          {viewMode === 'profiles' && (
            <div className="table-wrap table-sticky-header">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Profile</th>
                    <th>Kind</th>
                    <th style={{ textAlign: 'center' }}>Days</th>
                    {METRICS.map((m) => <th key={m.key} style={{ textAlign: 'right' }}>{m.short}</th>)}
                    <th style={{ textAlign: 'right' }}>Net Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {profileTotals.map((p, idx) => {
                    const net = (p.t.totalDepositAmount || 0) - (p.t.totalWithdrawalAmount || 0);
                    const best: Record<string, boolean> = {};
                    for (const m of METRICS) {
                      const max = Math.max(...profileTotals.map((x) => x.t[m.key] || 0));
                      best[m.key] = (p.t[m.key] || 0) === max && max > 0;
                    }
                    return (
                      <tr key={p.id}>
                        <td className="cell-muted">{idx + 1}</td>
                        <td className="cell-name">{p.name}</td>
                        <td><span className={`badge ${p.kind === 'CGAMING' ? 'badge-success' : 'badge-info'}`}>{p.kind}</span></td>
                        <td style={{ textAlign: 'center' }}>{p.days}</td>
                        {METRICS.map((m) => (
                          <td key={m.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: best[m.key] ? 700 : 400, color: best[m.key] ? 'var(--success)' : undefined }}>
                            {fmt(p.t[m.key], m.isAmount)}
                          </td>
                        ))}
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {net >= 0 ? '+' : ''}{fmt(net, true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td></td>
                    <td>Total</td>
                    <td></td>
                    <td style={{ textAlign: 'center' }}>{dayCount}</td>
                    {METRICS.map((m) => <td key={m.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals[m.key], m.isAmount)}</td>)}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: netFlow >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {netFlow >= 0 ? '+' : ''}{fmt(netFlow, true)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── Detail table ── */}
          {viewMode === 'table' && (
            <div className="table-wrap table-sticky-header">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Profile</th>
                    <th>Kind</th>
                    {METRICS.map((m) => <th key={m.key} style={{ textAlign: 'right' }}>{m.short}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-muted" style={{ whiteSpace: 'nowrap' }}>{formatDisplayDate(r.reportDate)}</td>
                      <td className="cell-name">{r.profile.name}</td>
                      <td><span className={`badge ${r.profile.kind === 'CGAMING' ? 'badge-success' : 'badge-info'}`}>{r.profile.kind}</span></td>
                      {METRICS.map((m) => <td key={m.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r[m.key], m.isAmount)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {generated && data.length === 0 && <div className="empty-state"><p>No data found for the selected filters.</p></div>}

      {/* Landing state */}
      {!generated && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>◩</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Generate a Report</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            Select your date range and filters above, then click Generate. You'll see KPI tiles, trend charts, deposit vs withdrawal analysis, and per-profile breakdowns.
          </div>
        </div>
      )}
    </div>
  );
}

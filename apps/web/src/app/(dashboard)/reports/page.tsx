'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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

type ViewMode = 'table' | 'summary' | 'comparison' | 'charts';

const CHART_COLORS_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const CHART_COLORS_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

function useTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const check = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      setTheme(attr === 'light' ? 'light' : 'dark');
    };
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function TrendChart({ data, metric, theme }: {
  data: ScrapeRow[];
  metric: typeof METRICS[number];
  theme: 'dark' | 'light';
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: string } | null>(null);

  const { dates, values, maxVal } = useMemo(() => {
    const byDate: Record<string, number> = {};
    for (const r of data) {
      const d = r.reportDateString;
      const v = r[metric.key];
      const n = v !== null && v !== undefined ? (typeof v === 'string' ? parseFloat(v) : v) : 0;
      byDate[d] = (byDate[d] || 0) + n;
    }
    const sorted = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
    const vals = sorted.map(([, v]) => v);
    return { dates: sorted.map(([d]) => d), values: vals, maxVal: Math.max(...vals, 1) };
  }, [data, metric]);

  const W = 600, H = 220, PL = 70, PR = 20, PT = 20, PB = 50;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const colors = theme === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
  const textColor = theme === 'dark' ? '#c3c2b7' : '#52514e';
  const gridColor = theme === 'dark' ? '#2c2c2a' : '#e1e0d9';
  const baselineColor = theme === 'dark' ? '#383835' : '#c3c2b7';

  const niceMax = useMemo(() => {
    if (maxVal === 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(maxVal)));
    return Math.ceil(maxVal / mag) * mag;
  }, [maxVal]);

  const ticks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => (niceMax / steps) * i);
  }, [niceMax]);

  const points = useMemo(() => {
    if (dates.length === 0) return [];
    return values.map((v, i) => ({
      x: PL + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW),
      y: PT + plotH - (v / niceMax) * plotH,
      val: v,
      date: dates[i],
    }));
  }, [dates, values, niceMax, plotW, plotH]);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + (points.length > 0 ? ` L${points[points.length - 1].x},${PT + plotH} L${points[0].x},${PT + plotH} Z` : '');

  const handleMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const scale = W / rect.width;
    const sx = mx * scale;
    let closest = points[0], minDist = Math.abs(sx - points[0].x);
    for (let i = 1; i < points.length; i++) {
      const d = Math.abs(sx - points[i].x);
      if (d < minDist) { minDist = d; closest = points[i]; }
    }
    setTooltip({ x: closest.x, y: closest.y, label: closest.date, value: formatNum(closest.val, metric.isAmount) });
  }, [points, metric.isAmount]);

  if (dates.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20 }}>No data</div>;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Grid */}
        {ticks.map((t) => {
          const y = PT + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={PL} x2={PL + plotW} y1={y} y2={y} stroke={gridColor} strokeWidth={1} />
              <text x={PL - 8} y={y + 4} textAnchor="end" fill={textColor} fontSize={11} fontFamily="system-ui, sans-serif">
                {t >= 1000 ? `${(t / 1000).toLocaleString('en-US')}K` : t.toLocaleString('en-US')}
              </text>
            </g>
          );
        })}
        {/* Baseline */}
        <line x1={PL} x2={PL + plotW} y1={PT + plotH} y2={PT + plotH} stroke={baselineColor} strokeWidth={1} />

        {/* Area fill */}
        <path d={areaPath} fill={colors[0]} opacity={0.1} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={colors[0]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4} fill={colors[0]} stroke={theme === 'dark' ? '#0f1115' : '#f4f5f7'} strokeWidth={2} />
        ))}

        {/* X labels */}
        {points.filter((_, i) => {
          if (dates.length <= 10) return true;
          const step = Math.ceil(dates.length / 8);
          return i % step === 0 || i === dates.length - 1;
        }).map((p) => (
          <text key={p.date} x={p.x} y={PT + plotH + 20} textAnchor="middle" fill={textColor} fontSize={10} fontFamily="system-ui, sans-serif">
            {p.date.slice(5)}
          </text>
        ))}

        {/* End label */}
        {points.length > 0 && (
          <text x={points[points.length - 1].x + 6} y={points[points.length - 1].y + 4} fill={textColor} fontSize={11} fontWeight={600} fontFamily="system-ui, sans-serif">
            {formatNum(points[points.length - 1].val, metric.isAmount)}
          </text>
        )}

        {/* Crosshair + tooltip */}
        {tooltip && (
          <>
            <line x1={tooltip.x} x2={tooltip.x} y1={PT} y2={PT + plotH} stroke={textColor} strokeWidth={1} opacity={0.3} strokeDasharray="none" />
            <circle cx={tooltip.x} cy={tooltip.y} r={6} fill={colors[0]} stroke={theme === 'dark' ? '#0f1115' : '#f4f5f7'} strokeWidth={2} />
          </>
        )}
      </svg>
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: `${(tooltip.x / W) * 100}%`,
          top: 0,
          transform: 'translateX(-50%)',
          background: theme === 'dark' ? '#1a1a19' : '#fcfcfb',
          border: `1px solid ${theme === 'dark' ? '#383835' : '#e1e0d9'}`,
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 12,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <div style={{ fontWeight: 600 }}>{tooltip.value}</div>
          <div style={{ color: textColor, fontSize: 11 }}>{tooltip.label}</div>
        </div>
      )}
    </div>
  );
}

function MiniSparkline({ values, color, theme }: { values: number[]; color: string; theme: 'dark' | 'light' }) {
  if (values.length < 2) return null;
  const W = 200, H = 36;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - (v / max) * (H - 4) - 2,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = line + ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 36, display: 'block' }}>
      <path d={area} fill={color} opacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2.5} fill={color} />
    </svg>
  );
}

function BarChart({ data, metric, theme }: {
  data: { name: string; value: number }[];
  metric: typeof METRICS[number];
  theme: 'dark' | 'light';
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const colors = theme === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
  const textColor = theme === 'dark' ? '#c3c2b7' : '#52514e';
  const gridColor = theme === 'dark' ? '#2c2c2a' : '#e1e0d9';
  const barH = 22, gap = 4, PL = 100, PR = 80, PT = 10;
  const totalH = PT + data.length * (barH + gap) + 10;
  const W = 600, plotW = W - PL - PR;

  if (data.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20 }}>No data</div>;

  return (
    <svg viewBox={`0 0 ${W} ${totalH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
        <line key={frac} x1={PL + frac * plotW} x2={PL + frac * plotW} y1={PT} y2={totalH - 10} stroke={gridColor} strokeWidth={1} />
      ))}

      {data.map((d, i) => {
        const y = PT + i * (barH + gap);
        const w = Math.max((d.value / maxVal) * plotW, 0);
        const isHovered = hoveredIdx === i;
        return (
          <g key={d.name}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {/* Hit target */}
            <rect x={0} y={y} width={W} height={barH} fill="transparent" />
            {/* Label */}
            <text x={PL - 8} y={y + barH / 2 + 4} textAnchor="end" fill={textColor} fontSize={11} fontFamily="system-ui, sans-serif"
              style={{ opacity: isHovered ? 1 : 0.8 }}>
              {d.name.length > 12 ? d.name.slice(0, 11) + '…' : d.name}
            </text>
            {/* Bar */}
            <rect
              x={PL}
              y={y + 1}
              width={w}
              height={barH - 2}
              rx={4}
              fill={colors[0]}
              opacity={isHovered ? 1 : 0.8}
            />
            {/* Value */}
            <text x={PL + w + 6} y={y + barH / 2 + 4} fill={textColor} fontSize={11} fontWeight={600} fontFamily="system-ui, sans-serif">
              {formatNum(d.value, metric.isAmount)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

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
  const [chartMetric, setChartMetric] = useState<MetricKey>('totalDepositAmount');
  const theme = useTheme();

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
                { key: 'charts' as ViewMode, label: 'Charts' },
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
          ) : viewMode === 'comparison' ? (
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
          ) : (
            /* Charts view */
            <div>
              {/* Metric selector */}
              <div style={{ marginBottom: 16, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setChartMetric(m.key)}
                    style={{
                      padding: '6px 14px',
                      fontSize: 12,
                      fontWeight: chartMetric === m.key ? 600 : 400,
                      border: chartMetric === m.key ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: chartMetric === m.key ? 'rgba(79, 140, 255, 0.1)' : 'transparent',
                      color: chartMetric === m.key ? 'var(--accent)' : 'var(--muted)',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Daily trend line */}
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
                    Daily Trend — {METRICS.find((m) => m.key === chartMetric)?.label}
                  </div>
                  <TrendChart data={data} metric={METRICS.find((m) => m.key === chartMetric)!} theme={theme} />
                </div>

                {/* Profile bar chart */}
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
                    By Profile — {METRICS.find((m) => m.key === chartMetric)?.label}
                  </div>
                  <BarChart
                    data={comparisonData
                      .map((p) => ({ name: p.name, value: p.totals[chartMetric] || 0 }))
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 15)}
                    metric={METRICS.find((m) => m.key === chartMetric)!}
                    theme={theme}
                  />
                </div>
              </div>

              {/* All 6 metrics as small trend charts */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
                  All Metrics Overview
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {METRICS.map((m) => {
                    const byDate: Record<string, number> = {};
                    for (const r of data) {
                      const d = r.reportDateString;
                      const v = r[m.key];
                      const n = v !== null && v !== undefined ? (typeof v === 'string' ? parseFloat(v) : v) : 0;
                      byDate[d] = (byDate[d] || 0) + n;
                    }
                    const sorted = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
                    const total = sorted.reduce((s, [, v]) => s + v, 0);

                    return (
                      <div key={m.key} className="card" style={{ padding: '14px 16px', cursor: 'pointer', border: chartMetric === m.key ? '1px solid var(--accent)' : undefined }}
                        onClick={() => setChartMetric(m.key)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{m.label}</span>
                          <span style={{ fontSize: 18, fontWeight: 700 }}>{formatNum(total, m.isAmount)}</span>
                        </div>
                        <MiniSparkline values={sorted.map(([, v]) => v)} color={(theme === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT)[0]} theme={theme} />
                      </div>
                    );
                  })}
                </div>
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
            { title: 'Charts', desc: 'Interactive trend lines, bar charts, and sparkline overviews for all 6 metrics.' },
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

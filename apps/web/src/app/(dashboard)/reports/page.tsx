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

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '฿' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 10_000) return '฿' + (n / 1_000).toFixed(1) + 'K';
  return '฿' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

function shortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  return dateStr.slice(5);
}

type ViewMode = 'charts' | 'table' | 'profiles';

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

function Sparkline({ values, color, height = 32 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return null;
  const W = 120, H = height;
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

function TrendLine({ series, dates, theme, height = 240, title }: {
  series: { label: string; values: number[]; color: string }[];
  dates: string[];
  theme: 'dark' | 'light';
  height?: number;
  title?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 700, H = height, PL = 65, PR = 16, PT = 16, PB = 32;
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

  if (dates.length === 0) return <div className="text-muted text-[13px] p-5">No data</div>;

  const labelDates = dates.filter((_, i) => {
    if (dates.length <= 14) return true;
    const step = Math.ceil(dates.length / 10);
    return i % step === 0 || i === dates.length - 1;
  });

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 'auto' }}
        onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={PL + plotW} y1={py(t)} y2={py(t)} stroke={gridCol} strokeWidth={1} />
            <text x={PL - 8} y={py(t) + 4} textAnchor="end" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">
              {t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : t >= 1000 ? `${(t / 1000).toLocaleString('en-US')}K` : t.toLocaleString('en-US')}
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

        {labelDates.map((d) => (
          <text key={d} x={px(dates.indexOf(d))} y={PT + plotH + 16} textAnchor="middle" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">
            {shortDate(d)}
          </text>
        ))}

        {series.length > 1 && series.map((s, i) => (
          <g key={s.label} transform={`translate(${PL + i * 110}, ${H - 2})`}>
            <line x1={0} x2={16} y1={0} y2={0} stroke={s.color} strokeWidth={2} strokeLinecap="round" />
            <text x={20} y={4} fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">{s.label}</text>
          </g>
        ))}

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
        <div
          className="absolute top-0 pointer-events-none whitespace-nowrap z-10 rounded-md px-3 py-2 text-xs shadow-lg border bg-surface border-border"
          style={{ left: `${(px(hoverIdx) / W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <div className="text-[11px] text-muted mb-1">{formatDisplayDate(dates[hoverIdx])}</div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="flex-1 text-muted">{s.label}</span>
              <span className="font-semibold tabular-nums">{fmt(s.values[hoverIdx], s.label.includes('Amt'))}</span>
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
  const barH = 22, gap = 4, PL = 95, PR = 70, PT = 4;
  const W = 500, plotW = W - PL - PR;
  const totalH = PT + rows.length * (barH + gap) + 4;

  return (
    <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full block max-h-[500px]">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={PL + f * plotW} x2={PL + f * plotW} y1={PT} y2={totalH - 4} stroke={gridCol} strokeWidth={1} />
      ))}
      {rows.map((r, i) => {
        const y = PT + i * (barH + gap);
        const w = Math.max((r.value / max) * plotW, 0);
        const isH = hovered === i;
        return (
          <g key={r.label} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} className="cursor-default">
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

function StackedBar({ data, dates, theme }: {
  data: { kind: string; values: number[] }[];
  dates: string[];
  theme: 'dark' | 'light';
}) {
  const colors = theme === 'dark' ? COLORS_DARK : COLORS_LIGHT;
  const textCol = theme === 'dark' ? '#898781' : '#898781';
  const gridCol = theme === 'dark' ? '#2c2c2a' : '#e1e0d9';
  const W = 700, H = 180, PL = 65, PR = 16, PT = 12, PB = 32;
  const plotW = W - PL - PR, plotH = H - PT - PB;

  const totals = dates.map((_, i) => data.reduce((s, d) => s + (d.values[i] || 0), 0));
  const rawMax = Math.max(...totals, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil(rawMax / mag) * mag || 1;
  const barW = Math.min(plotW / dates.length * 0.6, 40);
  const gap = (plotW - barW * dates.length) / Math.max(dates.length - 1, 1);

  const labelDates = dates.filter((_, i) => {
    if (dates.length <= 14) return true;
    const step = Math.ceil(dates.length / 10);
    return i % step === 0 || i === dates.length - 1;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 'auto' }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = niceMax * f;
        const y = PT + plotH - (v / niceMax) * plotH;
        return (
          <g key={f}>
            <line x1={PL} x2={PL + plotW} y1={y} y2={y} stroke={gridCol} strokeWidth={1} />
            <text x={PL - 8} y={y + 4} textAnchor="end" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">
              {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)}
            </text>
          </g>
        );
      })}
      {dates.map((d, di) => {
        const x = PL + di * (barW + gap);
        let yOffset = PT + plotH;
        return (
          <g key={d}>
            {data.map((series, si) => {
              const val = series.values[di] || 0;
              const h = (val / niceMax) * plotH;
              yOffset -= h;
              return <rect key={series.kind} x={x} y={yOffset} width={barW} height={h} rx={1} fill={colors[si % colors.length]} opacity={0.8} />;
            })}
          </g>
        );
      })}
      {labelDates.map((d) => {
        const di = dates.indexOf(d);
        return (
          <text key={d} x={PL + di * (barW + gap) + barW / 2} y={PT + plotH + 16} textAnchor="middle" fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">
            {shortDate(d)}
          </text>
        );
      })}
      {data.map((s, i) => (
        <g key={s.kind} transform={`translate(${PL + i * 100}, ${H - 2})`}>
          <rect x={0} y={-5} width={12} height={8} rx={2} fill={colors[i % colors.length]} opacity={0.8} />
          <text x={16} y={3} fill={textCol} fontSize={10} fontFamily="system-ui,sans-serif">{s.kind}</text>
        </g>
      ))}
    </svg>
  );
}

function SortHeader({ label, col, sort, onSort, align }: {
  label: string; col: string;
  sort: { col: string; dir: 'asc' | 'desc' };
  onSort: (col: string) => void;
  align?: 'left' | 'center' | 'right';
}) {
  const active = sort.col === col;
  return (
    <th
      className={`cursor-pointer select-none hover:text-accent transition-colors ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1" style={{ justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}>
        {label}
        <span className={`text-[10px] ${active ? 'text-accent' : 'opacity-30'}`}>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );
}

function toggleSort(
  current: { col: string; dir: 'asc' | 'desc' },
  col: string,
  setter: (v: { col: string; dir: 'asc' | 'desc' }) => void,
) {
  if (current.col === col) setter({ col, dir: current.dir === 'asc' ? 'desc' : 'asc' });
  else setter({ col, dir: 'desc' });
}

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

  const [profileSort, setProfileSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });
  const [detailSort, setDetailSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'date', dir: 'desc' });

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

  const sortedProfileTotals = useMemo(() => {
    const list = [...profileTotals];
    const { col, dir } = profileSort;
    const m = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (col === 'name') return a.name.localeCompare(b.name) * m;
      if (col === 'kind') return a.kind.localeCompare(b.kind) * m;
      if (col === 'days') return (a.days - b.days) * m;
      if (col === 'netFlow') {
        const na = (a.t.totalDepositAmount || 0) - (a.t.totalWithdrawalAmount || 0);
        const nb = (b.t.totalDepositAmount || 0) - (b.t.totalWithdrawalAmount || 0);
        return (na - nb) * m;
      }
      return ((a.t[col] || 0) - (b.t[col] || 0)) * m;
    });
    return list;
  }, [profileTotals, profileSort]);

  const sortedDetailData = useMemo(() => {
    const list = [...data];
    const { col, dir } = detailSort;
    const m = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (col === 'date') return a.reportDateString.localeCompare(b.reportDateString) * m;
      if (col === 'profile') return a.profile.name.localeCompare(b.profile.name) * m;
      if (col === 'kind') return a.profile.kind.localeCompare(b.profile.kind) * m;
      return (numVal(a[col as MetricKey]) - numVal(b[col as MetricKey])) * m;
    });
    return list;
  }, [data, detailSort]);

  const platformAgg = useMemo(() => {
    const byKind: Record<string, { dep: number; wd: number; net: number; reg: number; count: number }> = {};
    for (const r of data) {
      const k = r.profile.kind;
      if (!byKind[k]) byKind[k] = { dep: 0, wd: 0, net: 0, reg: 0, count: 0 };
      byKind[k].dep += numVal(r.totalDepositAmount);
      byKind[k].wd += numVal(r.totalWithdrawalAmount);
      byKind[k].reg += numVal(r.newRegistrationCount);
    }
    for (const k of Object.keys(byKind)) {
      byKind[k].net = byKind[k].dep - byKind[k].wd;
      byKind[k].count = profileTotals.filter(p => p.kind === k).length;
    }
    return Object.entries(byKind).sort((a, b) => b[1].dep - a[1].dep);
  }, [data, profileTotals]);

  const dailyByKind = useMemo(() => {
    const kindSet = new Set(data.map(r => r.profile.kind));
    const kindList = [...kindSet].sort();
    return kindList.map(kind => ({
      kind,
      values: dailyAgg.dates.map(d => {
        let total = 0;
        for (const r of data) {
          if (r.reportDateString === d && r.profile.kind === kind) {
            total += numVal(r.totalDepositAmount);
          }
        }
        return total;
      }),
    }));
  }, [data, dailyAgg.dates]);

  const bestDay = useMemo(() => {
    if (dailyAgg.dates.length < 2) return null;
    let bestIdx = 0, bestNet = -Infinity;
    for (let i = 0; i < dailyAgg.rows.length; i++) {
      const net = (dailyAgg.rows[i].totalDepositAmount || 0) - (dailyAgg.rows[i].totalWithdrawalAmount || 0);
      if (net > bestNet) { bestNet = net; bestIdx = i; }
    }
    return { date: dailyAgg.dates[bestIdx], net: bestNet };
  }, [dailyAgg]);

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

  return (
    <div>
      {error && <div className="error-msg mb-3">{error}</div>}

      {/* ── Filter bar ── */}
      <div className="report-filter-bar">
        <div className="report-filter-row">
          <div className="report-filter-group">
            <div className="report-filter-field">
              <label className="report-filter-label">Platform</label>
              <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setSelectedProfiles([]); }} className="report-select">
                <option value="ALL">All</option>
                {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="report-filter-field">
              <label className="report-filter-label">Date</label>
              <select value={dateMode} onChange={(e) => setDateMode(e.target.value as any)} className="report-select">
                <option value="range">Range</option>
                <option value="single">Single</option>
              </select>
            </div>
            {dateMode === 'single' ? (
              <div className="report-filter-field">
                <label className="report-filter-label">Date</label>
                <input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} className="report-input" />
              </div>
            ) : (
              <>
                <div className="report-filter-field">
                  <label className="report-filter-label">From</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="report-input" />
                </div>
                <div className="report-filter-field">
                  <label className="report-filter-label">To</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="report-input" />
                </div>
              </>
            )}
          </div>

          <div className="report-filter-actions">
            <div className="report-presets">
              {[
                { l: 'Today', fn: () => { setDateMode('single'); setSingleDate(toDateStr(new Date())); } },
                { l: 'Yest', fn: () => { setDateMode('single'); const d = new Date(); d.setDate(d.getDate() - 1); setSingleDate(toDateStr(d)); } },
                { l: '7d', fn: () => { setDateMode('range'); const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); } },
                { l: '30d', fn: () => { setDateMode('range'); const d = new Date(); d.setDate(d.getDate() - 29); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); } },
                { l: 'MTD', fn: () => { setDateMode('range'); const n = new Date(); setDateFrom(toDateStr(new Date(n.getFullYear(), n.getMonth(), 1))); setDateTo(toDateStr(n)); } },
                { l: 'Last Mo', fn: () => { setDateMode('range'); const n = new Date(); setDateFrom(toDateStr(new Date(n.getFullYear(), n.getMonth() - 1, 1))); setDateTo(toDateStr(new Date(n.getFullYear(), n.getMonth(), 0))); } },
              ].map((p) => (
                <button key={p.l} type="button" onClick={p.fn} className="report-preset-btn">{p.l}</button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowProfilePicker(!showProfilePicker)}
              className={`report-preset-btn ${selectedProfiles.length > 0 ? 'active' : ''}`}
            >
              {selectedProfiles.length > 0 ? `${selectedProfiles.length} profiles` : 'All profiles'}
            </button>
            <button className="btn btn-primary h-[34px] px-5" onClick={generate} disabled={loading}>
              {loading ? 'Loading…' : 'Generate'}
            </button>
          </div>
        </div>

        {showProfilePicker && (
          <div className="report-profile-picker">
            <div className="flex justify-between items-center mb-1.5">
              <input type="text" placeholder="Search profiles…" value={profileSearch} onChange={(e) => setProfileSearch(e.target.value)} className="w-40 h-[26px] text-[11px] px-2 bg-bg border border-border rounded-sm" />
              <div className="flex gap-1">
                <button type="button" onClick={() => setSelectedProfiles(filteredProfiles.map((p) => p.id))} className="report-preset-btn text-[10px]">All</button>
                <button type="button" onClick={() => setSelectedProfiles([])} className="report-preset-btn text-[10px]">Clear</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {filteredProfiles.map((p) => {
                const sel = selectedProfiles.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProfiles((prev) => sel ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
                    className={`report-preset-btn ${sel ? 'active' : ''}`}
                  >
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
          {/* KPI strip */}
          <div className="report-kpi-strip">
            <div className={`report-kpi-hero ${netFlow >= 0 ? 'positive' : 'negative'}`}>
              <div className="report-kpi-label">Net Flow</div>
              <div className={`report-kpi-value-hero ${netFlow >= 0 ? 'text-success' : 'text-error'}`}>
                {netFlow >= 0 ? '+' : ''}{fmtCurrency(netFlow)}
              </div>
              <div className="report-kpi-sub tabular-nums">{fmtCurrency(netFlow / dayCount)}/day avg</div>
              {dailyAgg.rows.length > 1 && (
                <div className="mt-1.5">
                  <Sparkline
                    values={dailyAgg.rows.map((r) => (r.totalDepositAmount || 0) - (r.totalWithdrawalAmount || 0))}
                    color={netFlow >= 0 ? '#199e70' : '#e66767'}
                    height={24}
                  />
                </div>
              )}
            </div>

            {METRICS.map((m) => {
              const total = totals[m.key];
              const avg = total / dayCount;
              const vals = dailyAgg.rows.map((r) => r[m.key] || 0);
              const isWd = m.key.includes('Withdrawal');
              const sparkColor = isWd ? colors[1] : colors[0];
              const isActive = chartMetric === m.key;
              return (
                <div
                  key={m.key}
                  onClick={() => setChartMetric(m.key)}
                  className={`report-kpi-card ${isActive ? 'active' : ''}`}
                >
                  <div className="report-kpi-label">{m.short}</div>
                  <div className="report-kpi-value tabular-nums">{m.isAmount ? fmtCurrency(total) : fmtCompact(total)}</div>
                  <div className="report-kpi-sub tabular-nums">{m.isAmount ? fmtCurrency(avg) : fmtCompact(avg)}/day</div>
                  <div className="mt-1.5">
                    <Sparkline values={vals} color={sparkColor} height={24} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Insights row */}
          {dailyAgg.dates.length > 1 && (
            <div className="report-insights">
              <div className="report-insight">
                <span className="report-insight-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                </span>
                <span>{dayCount} days · {profileTotals.length} profiles · {data.length} records</span>
              </div>
              {bestDay && (
                <div className="report-insight">
                  <span className="report-insight-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  </span>
                  <span>Best day: <strong>{formatDisplayDate(bestDay.date)}</strong> ({netFlow >= 0 ? '+' : ''}{fmtCurrency(bestDay.net)} net)</span>
                </div>
              )}
              {platformAgg.length > 1 && (
                <div className="report-insight">
                  <span className="report-insight-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </span>
                  <span>Top platform: <strong>{platformAgg[0][0]}</strong> ({fmtCurrency(platformAgg[0][1].dep)} deposits)</span>
                </div>
              )}
            </div>
          )}

          {/* Tabs + export */}
          <div className="report-tabs-row">
            <div className="tabs">
              {([
                { key: 'charts' as ViewMode, label: 'Charts' },
                { key: 'profiles' as ViewMode, label: 'Profiles' },
                { key: 'table' as ViewMode, label: 'Detail' },
              ]).map((t) => (
                <button key={t.key} className={`tab ${viewMode === t.key ? 'tab-active' : ''}`} onClick={() => setViewMode(t.key)}>{t.label}</button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <button type="button" onClick={exportCSV} className="report-preset-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                CSV
              </button>
            </div>
          </div>

          {/* ── Charts tab ── */}
          {viewMode === 'charts' && (
            <div className="flex flex-col gap-4">
              <div className="report-chart-card">
                <div className="report-chart-header">
                  <span className="report-chart-title">Deposit vs Withdrawal</span>
                  <span className="report-chart-badge">{dayCount} days</span>
                </div>
                <TrendLine
                  dates={dailyAgg.dates}
                  series={[
                    { label: 'Deposit Amt', values: dailyAgg.rows.map((r) => r.totalDepositAmount || 0), color: colors[0] },
                    { label: 'Withdrawal Amt', values: dailyAgg.rows.map((r) => r.totalWithdrawalAmount || 0), color: colors[1] },
                  ]}
                  theme={theme}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
                <div className="report-chart-card">
                  <div className="report-chart-header">
                    <span className="report-chart-title">
                      {METRICS.find((m) => m.key === chartMetric)?.label} — Daily
                    </span>
                    <select
                      value={chartMetric}
                      onChange={(e) => setChartMetric(e.target.value as MetricKey)}
                      className="report-chart-select"
                    >
                      {METRICS.map((m) => <option key={m.key} value={m.key}>{m.short}</option>)}
                    </select>
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

                <div className="report-chart-card">
                  <div className="report-chart-header">
                    <span className="report-chart-title">
                      Top Profiles — {METRICS.find((m) => m.key === chartMetric)?.short}
                    </span>
                  </div>
                  <HBar
                    rows={profileTotals.map((p) => ({ label: p.name, value: p.t[chartMetric] || 0, isAmount: METRICS.find((m) => m.key === chartMetric)?.isAmount })).sort((a, b) => b.value - a.value).slice(0, 12)}
                    theme={theme}
                    color={chartMetric.includes('Withdrawal') ? colors[1] : colors[0]}
                  />
                </div>
              </div>

              {/* Platform breakdown */}
              {platformAgg.length > 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
                  <div className="report-chart-card">
                    <div className="report-chart-header">
                      <span className="report-chart-title">Deposits by Platform — Daily</span>
                    </div>
                    <StackedBar data={dailyByKind} dates={dailyAgg.dates} theme={theme} />
                  </div>

                  <div className="report-chart-card">
                    <div className="report-chart-header">
                      <span className="report-chart-title">Platform Summary</span>
                    </div>
                    <div className="report-platform-grid">
                      {platformAgg.map(([kind, d]) => {
                        const pct = totals.totalDepositAmount > 0 ? (d.dep / totals.totalDepositAmount * 100) : 0;
                        return (
                          <div key={kind} className="report-platform-item">
                            <div className="flex items-center justify-between mb-2">
                              <span className={`badge badge-${kind.toLowerCase()}`}>{kind}</span>
                              <span className="text-[11px] text-muted">{d.count} profiles</span>
                            </div>
                            <div className="report-platform-bar-track">
                              <div className="report-platform-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                              <div>
                                <div className="text-[10px] text-muted">Deposits</div>
                                <div className="text-xs font-semibold tabular-nums">{fmtCompact(d.dep, true)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-muted">Withdrawals</div>
                                <div className="text-xs font-semibold tabular-nums">{fmtCompact(d.wd, true)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-muted">Net</div>
                                <div className={`text-xs font-bold tabular-nums ${d.net >= 0 ? 'text-success' : 'text-error'}`}>
                                  {d.net >= 0 ? '+' : ''}{fmtCompact(d.net, true)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="report-chart-card">
                  <div className="report-chart-header">
                    <span className="report-chart-title">Registrations + New Deposits</span>
                  </div>
                  <TrendLine dates={dailyAgg.dates} series={[
                    { label: 'New Reg', values: dailyAgg.rows.map((r) => r.newRegistrationCount || 0), color: colors[2] },
                    { label: 'New Dep', values: dailyAgg.rows.map((r) => r.newDepositCount || 0), color: colors[0] },
                  ]} theme={theme} height={180} />
                </div>
                <div className="report-chart-card">
                  <div className="report-chart-header">
                    <span className="report-chart-title">Deposit vs Withdrawal Count</span>
                  </div>
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
                    <SortHeader label="Profile" col="name" sort={profileSort} onSort={(c) => toggleSort(profileSort, c, setProfileSort)} />
                    <SortHeader label="Kind" col="kind" sort={profileSort} onSort={(c) => toggleSort(profileSort, c, setProfileSort)} />
                    <SortHeader label="Days" col="days" sort={profileSort} onSort={(c) => toggleSort(profileSort, c, setProfileSort)} align="center" />
                    {METRICS.map((m) => <SortHeader key={m.key} label={m.short} col={m.key} sort={profileSort} onSort={(c) => toggleSort(profileSort, c, setProfileSort)} align="right" />)}
                    <SortHeader label="Net Flow" col="netFlow" sort={profileSort} onSort={(c) => toggleSort(profileSort, c, setProfileSort)} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedProfileTotals.map((p, idx) => {
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
                        <td><span className={`badge badge-${p.kind.toLowerCase()}`}>{p.kind}</span></td>
                        <td className="text-center">{p.days}</td>
                        {METRICS.map((m) => (
                          <td key={m.key} className={`text-right tabular-nums ${best[m.key] ? 'font-bold text-success' : ''}`}>
                            {fmt(p.t[m.key], m.isAmount)}
                          </td>
                        ))}
                        <td className={`text-right tabular-nums font-semibold ${net >= 0 ? 'text-success' : 'text-error'}`}>
                          {net >= 0 ? '+' : ''}{fmt(net, true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td></td>
                    <td>Total</td>
                    <td></td>
                    <td className="text-center">{dayCount}</td>
                    {METRICS.map((m) => <td key={m.key} className="text-right tabular-nums">{fmt(totals[m.key], m.isAmount)}</td>)}
                    <td className={`text-right tabular-nums ${netFlow >= 0 ? 'text-success' : 'text-error'}`}>
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
                    <SortHeader label="Date" col="date" sort={detailSort} onSort={(c) => toggleSort(detailSort, c, setDetailSort)} />
                    <SortHeader label="Profile" col="profile" sort={detailSort} onSort={(c) => toggleSort(detailSort, c, setDetailSort)} />
                    <SortHeader label="Kind" col="kind" sort={detailSort} onSort={(c) => toggleSort(detailSort, c, setDetailSort)} />
                    {METRICS.map((m) => <SortHeader key={m.key} label={m.short} col={m.key} sort={detailSort} onSort={(c) => toggleSort(detailSort, c, setDetailSort)} align="right" />)}
                  </tr>
                </thead>
                <tbody>
                  {sortedDetailData.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-muted whitespace-nowrap">{formatDisplayDate(r.reportDateString)}</td>
                      <td className="cell-name">{r.profile.name}</td>
                      <td><span className={`badge badge-${r.profile.kind.toLowerCase()}`}>{r.profile.kind}</span></td>
                      {METRICS.map((m) => <td key={m.key} className="text-right tabular-nums">{fmt(r[m.key], m.isAmount)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {generated && data.length === 0 && <div className="empty-state"><p>No data found for the selected filters.</p></div>}

      {!generated && (
        <div className="report-landing">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="report-landing-icon">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <div className="report-landing-title">Generate a Report</div>
          <div className="report-landing-desc">
            Select your date range and filters above, then click Generate.
            You'll see KPI tiles, trend charts, and per-profile breakdowns.
          </div>
        </div>
      )}
    </div>
  );
}

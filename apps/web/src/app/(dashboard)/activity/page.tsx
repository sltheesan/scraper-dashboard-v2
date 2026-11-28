'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface ActivityEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  target: string;
  details: string;
  createdAt: string;
  actor?: { name: string; email: string } | null;
}

interface ActivityResponse {
  items: ActivityEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const ACTOR_TYPES = ['ALL', 'USER', 'TELEGRAM', 'SYSTEM', 'ADMIN'] as const;

function formatDate(d: string) {
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
}

export default function ActivityPage() {
  const { hasPrivilege } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [actions, setActions] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 50;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!hasPrivilege('activity.view')) {
      router.replace('/');
      return;
    }
    api.get<string[]>('/activity/actions').then(setActions).catch(() => {});
  }, [hasPrivilege, router]);

  function toDateStr(d: Date) {
    return d.toISOString().slice(0, 10);
  }

  async function loadActivity(p: number, actorType: string, action: string, q: string, from?: string, to?: string) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (actorType !== 'ALL') params.set('actorType', actorType);
      if (action !== 'ALL') params.set('action', action);
      if (q.trim()) params.set('search', q.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await api.get<ActivityResponse>(`/activity?${params}`);
      setEntries(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadActivity(1, filter, actionFilter, search, dateFrom, dateTo);
  }, [filter, actionFilter, search, dateFrom, dateTo]);

  function handleSearchInput(val: string) {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 400);
  }

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      {error && <div className="error-msg mb-4">{error}</div>}

      <div className="activity-toolbar">
        <div className="tabs">
          {ACTOR_TYPES.map((t) => (
            <button
              key={t}
              className={`tab ${filter === t ? 'tab-active' : ''}`}
              onClick={() => { setFilter(t); setPage(1); }}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="activity-filters">
          <select
            className="filter-select"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="ALL">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <div className="search-box">
            <span className="search-icon">⌕</span>
            <input
              type="text"
              placeholder="Search activity..."
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
            />
            {searchInput && (
              <button className="search-clear" onClick={() => { setSearchInput(''); setSearch(''); }}>×</button>
            )}
          </div>
        </div>

        <div className="activity-date-filters">
          <div className="date-range-inputs">
            <label className="date-label">
              From
              <input type="date" className="filter-input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            </label>
            <label className="date-label">
              To
              <input type="date" className="filter-input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </label>
            {(dateFrom || dateTo) && (
              <button className="btn btn-sm btn-ghost" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>Clear</button>
            )}
          </div>
          <div className="date-presets">
            <button className={`btn btn-sm ${dateFrom === toDateStr(new Date()) && !dateTo ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setDateFrom(toDateStr(new Date())); setDateTo(''); setPage(1); }}>Today</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); setPage(1); }}>7d</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); setDateFrom(toDateStr(d)); setDateTo(toDateStr(new Date())); setPage(1); }}>30d</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-card" style={{ padding: '20px' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-text" style={{ width: '15%' }} />
              <div className="skeleton-text" style={{ width: '10%' }} />
              <div className="skeleton-text" style={{ width: '12%' }} />
              <div className="skeleton-text" style={{ width: '20%' }} />
              <div className="skeleton-text" style={{ width: '25%' }} />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state"><p>No activity logs found.</p></div>
      ) : (
        <>
          <div className="table-wrap table-sticky-header">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="hidden sm:table-cell">Actor Type</th>
                  <th className="hidden md:table-cell">Actor</th>
                  <th>Action</th>
                  <th className="hidden lg:table-cell">Target</th>
                  <th className="hidden lg:table-cell">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-muted whitespace-nowrap text-xs">{formatDate(e.createdAt)}</td>
                    <td className="hidden sm:table-cell">
                      <span className={`badge badge-actor-${e.actorType.toLowerCase()}`}>
                        {e.actorType}
                      </span>
                    </td>
                    <td className="hidden md:table-cell">{e.actor?.name || e.actorId || '—'}</td>
                    <td className="cell-name">{e.action}</td>
                    <td className="hidden lg:table-cell">{e.target || '—'}</td>
                    <td className="cell-muted max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap hidden lg:table-cell">
                      {e.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="btn btn-sm btn-ghost"
              disabled={page <= 1}
              onClick={() => loadActivity(page - 1, filter, actionFilter, search, dateFrom, dateTo)}
            >
              ← Prev
            </button>
            <span className="pagination-info">
              Page {page} of {totalPages} ({total} entries)
            </span>
            <button
              className="btn btn-sm btn-ghost"
              disabled={page >= totalPages}
              onClick={() => loadActivity(page + 1, filter, actionFilter, search, dateFrom, dateTo)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

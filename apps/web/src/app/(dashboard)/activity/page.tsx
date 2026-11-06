'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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

const ACTOR_TYPES = ['ALL', 'USER', 'TELEGRAM', 'SYSTEM'] as const;

function formatDate(d: string) {
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 50;

  async function loadActivity(p: number, f: string) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (f !== 'ALL') params.set('actorType', f);
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
    loadActivity(1, filter);
  }, [filter]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="tabs" style={{ marginBottom: 20 }}>
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

      {loading ? (
        <div className="loading-screen"><div className="spinner" /></div>
      ) : entries.length === 0 ? (
        <div className="empty-state"><p>No activity logs.</p></div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor Type</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(e.createdAt)}</td>
                    <td>
                      <span className={`badge badge-actor-${e.actorType.toLowerCase()}`}>
                        {e.actorType}
                      </span>
                    </td>
                    <td>{e.actor?.name || e.actorId || '—'}</td>
                    <td className="cell-name">{e.action}</td>
                    <td>{e.target || '—'}</td>
                    <td className="cell-muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              onClick={() => loadActivity(page - 1, filter)}
            >
              ← Prev
            </button>
            <span className="pagination-info">
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-sm btn-ghost"
              disabled={page >= totalPages}
              onClick={() => loadActivity(page + 1, filter)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

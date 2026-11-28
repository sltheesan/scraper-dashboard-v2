'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface LogEvent {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'debug';
  message: string;
  profile?: string;
  timestamp: string;
}

const TYPE_COLORS: Record<string, string> = {
  info: 'var(--muted)',
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',
  debug: 'var(--accent)',
};

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
}

export default function LogsPage() {
  const { hasPrivilege } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [profileFilter, setProfileFilter] = useState('ALL');
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const logTypes = useMemo(() => [...new Set(logs.map((l) => l.type))].sort(), [logs]);
  const logProfiles = useMemo(() => [...new Set(logs.map((l) => l.profile).filter(Boolean))].sort() as string[], [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter((l) => {
      if (typeFilter !== 'ALL' && l.type !== typeFilter) return false;
      if (profileFilter !== 'ALL' && l.profile !== profileFilter) return false;
      if (q && !l.message.toLowerCase().includes(q) && !(l.profile || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, typeFilter, profileFilter]);

  const hasFilters = search || typeFilter !== 'ALL' || profileFilter !== 'ALL';

  useEffect(() => {
    if (!hasPrivilege('logs.view')) {
      router.replace('/');
      return;
    }
    api.get<LogEvent[]>('/logs/recent')
      .then((data) => setLogs(data))
      .catch(() => {});

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const url = `/api/logs/stream${token ? `?token=${token}` : ''}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LogEvent;
        setLogs((prev) => [...prev.slice(-499), parsed]);
      } catch {}
    };
    es.onerror = () => setConnected(false);

    return () => { es.close(); };
  }, [hasPrivilege, router]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (autoScroll && !atBottom) setAutoScroll(false);
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 52px - 56px)' }}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3 shrink-0">
        <div className="flex items-center text-sm">
          <span className={`status-dot ${connected ? 'status-logged_in' : 'status-error'}`} />
          {connected ? 'Connected' : 'Disconnected'}
          <span className="cell-muted ml-3">{logs.length} events</span>
        </div>
        <div className="flex gap-2">
          <button
            className={`btn btn-sm ${autoScroll ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setAutoScroll(!autoScroll);
              if (!autoScroll && containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
            }}
          >
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center mb-2 shrink-0">
        <input
          type="text"
          placeholder="Search logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-[30px] text-xs px-2.5 bg-bg border border-border rounded-sm w-48"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-[30px] text-xs px-2 bg-bg border border-border rounded-sm"
        >
          <option value="ALL">All types</option>
          {logTypes.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        {logProfiles.length > 0 && (
          <select
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            className="h-[30px] text-xs px-2 bg-bg border border-border rounded-sm"
          >
            <option value="ALL">All profiles</option>
            {logProfiles.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {hasFilters && (
          <button
            className="btn btn-sm btn-ghost text-xs"
            onClick={() => { setSearch(''); setTypeFilter('ALL'); setProfileFilter('ALL'); }}
          >
            Reset
          </button>
        )}
        {hasFilters && (
          <span className="text-[11px] text-muted">{filteredLogs.length} / {logs.length}</span>
        )}
      </div>

      <div className="log-viewer" ref={containerRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 ? (
          <div className="log-empty">{hasFilters ? 'No logs match filters' : 'Waiting for log events…'}</div>
        ) : (
          filteredLogs.map((entry, i) => (
            <div key={entry.id || i} className="log-line">
              <span className="log-time">{formatTime(entry.timestamp)}</span>
              <span
                className="log-type"
                style={{ color: TYPE_COLORS[entry.type] || 'var(--muted)' }}
              >
                [{entry.type.toUpperCase()}]
              </span>
              {entry.profile && (
                <span className="log-profile">{entry.profile}</span>
              )}
              <span className="log-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

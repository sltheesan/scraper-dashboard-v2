'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface LogEvent {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'debug' | string;
  message: string;
  profile?: string;
  timestamp: string;
}

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  telegram: { label: 'TG', color: '#58a6ff', bg: 'rgba(88,166,255,.12)' },
  fetch:    { label: 'FETCH', color: 'var(--success)', bg: 'rgba(52,211,153,.10)' },
  refresh:  { label: 'REFRESH', color: '#a78bfa', bg: 'rgba(167,139,250,.10)' },
  error:    { label: 'ERROR', color: 'var(--error)', bg: 'rgba(255,93,93,.10)' },
  alert:    { label: 'ALERT', color: 'var(--warning)', bg: 'rgba(251,191,36,.10)' },
  scheduler:{ label: 'SCHED', color: '#f472b6', bg: 'rgba(244,114,182,.10)' },
  info:     { label: 'INFO', color: 'var(--muted)', bg: 'rgba(138,146,158,.08)' },
  success:  { label: 'OK', color: 'var(--success)', bg: 'rgba(52,211,153,.10)' },
  warning:  { label: 'WARN', color: 'var(--warning)', bg: 'rgba(251,191,36,.10)' },
  debug:    { label: 'DEBUG', color: 'var(--accent)', bg: 'rgba(79,140,255,.08)' },
};

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
}

function formatTimeShort(d: string) {
  return new Date(d).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok', hour12: false, hour: '2-digit', minute: '2-digit',
  });
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
    if (!hasPrivilege('logs.view')) { router.replace('/'); return; }
    api.get<LogEvent[]>('/logs/recent').then(setLogs).catch(() => {});

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const url = `/api/logs/stream${token ? `?token=${token}` : ''}`;
    const es = new EventSource(url);

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

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of logs) counts[l.type] = (counts[l.type] || 0) + 1;
    return counts;
  }, [logs]);

  return (
    <div className="logs-page">
      {/* ── Toolbar ── */}
      <div className="logs-toolbar">
        <div className="logs-toolbar-left">
          <div className={`logs-status ${connected ? 'online' : 'offline'}`}>
            <span className="logs-status-dot" />
            <span>{connected ? 'Live' : 'Disconnected'}</span>
          </div>

          <div className="logs-search-wrap">
            <svg className="logs-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              placeholder="Filter logs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="logs-search"
            />
            {search && (
              <button className="logs-search-clear" onClick={() => setSearch('')}>&times;</button>
            )}
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="logs-filter-select"
          >
            <option value="ALL">All types</option>
            {logTypes.map((t) => {
              const meta = TYPE_META[t];
              return <option key={t} value={t}>{(meta?.label || t).toUpperCase()} ({typeCounts[t] || 0})</option>;
            })}
          </select>

          {logProfiles.length > 0 && (
            <select
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
              className="logs-filter-select"
            >
              <option value="ALL">All profiles</option>
              {logProfiles.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}

          {hasFilters && (
            <button
              className="logs-reset-btn"
              onClick={() => { setSearch(''); setTypeFilter('ALL'); setProfileFilter('ALL'); }}
            >
              Reset
            </button>
          )}
        </div>

        <div className="logs-toolbar-right">
          {hasFilters && (
            <span className="logs-filter-count">{filteredLogs.length} / {logs.length}</span>
          )}
          <span className="logs-event-count">{logs.length} events</span>
          <button
            className={`logs-action-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => {
              setAutoScroll(!autoScroll);
              if (!autoScroll && containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
            }}
            title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button
            className="logs-action-btn"
            onClick={() => setLogs([])}
            title="Clear logs"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* ── Log viewer ── */}
      <div className="logs-container" ref={containerRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 ? (
          <div className="logs-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            <span>{hasFilters ? 'No logs match current filters' : 'Waiting for log events…'}</span>
          </div>
        ) : (
          filteredLogs.map((entry, i) => {
            const meta = TYPE_META[entry.type] || TYPE_META.info!;
            const prevTime = i > 0 ? formatTimeShort(filteredLogs[i - 1].timestamp) : '';
            const thisTime = formatTimeShort(entry.timestamp);
            const dimTime = i > 0 && prevTime === thisTime;

            return (
              <div key={entry.id || i} className={`logs-row ${i % 2 === 0 ? 'even' : ''}`}>
                <span className={`logs-row-time ${dimTime ? 'dim' : ''}`}>
                  {formatTime(entry.timestamp)}
                </span>
                <span
                  className="logs-row-badge"
                  style={{ color: meta.color, background: meta.bg }}
                >
                  {(meta.label || entry.type).toUpperCase()}
                </span>
                {entry.profile && (
                  <span className="logs-row-profile">{entry.profile}</span>
                )}
                <span className="logs-row-msg">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

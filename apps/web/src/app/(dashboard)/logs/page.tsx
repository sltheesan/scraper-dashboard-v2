'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

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
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
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
  }, []);

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
    <div className="logs-page">
      <div className="logs-toolbar">
        <div className="logs-status">
          <span className={`status-dot ${connected ? 'status-logged_in' : 'status-error'}`} />
          {connected ? 'Connected' : 'Disconnected'}
          <span className="cell-muted" style={{ marginLeft: 12 }}>{logs.length} events</span>
        </div>
        <div className="logs-controls">
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

      <div className="log-viewer" ref={containerRef} onScroll={handleScroll}>
        {logs.length === 0 ? (
          <div className="log-empty">Waiting for log events…</div>
        ) : (
          logs.map((entry, i) => (
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

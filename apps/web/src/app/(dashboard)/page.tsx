'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Profile {
  id: string;
  name: string;
  kind: string;
  status: string;
  lastScrapeAt: string | null;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
}

export default function DashboardHome() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Profile[]>('/profiles')
      .then(setProfiles)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total = profiles.length;
  const active = profiles.filter((p) => p.status === 'LOGGED_IN' || p.status === 'SCRAPING').length;
  const idle = profiles.filter((p) => p.status === 'IDLE').length;
  const issues = profiles.filter((p) => p.status === 'LOGGED_OUT' || p.status === 'ERROR').length;

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Profiles</div>
          <div className="stat-value">{total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Idle</div>
          <div className="stat-value" style={{ color: 'var(--muted)' }}>{idle}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Issues</div>
          <div className="stat-value" style={{ color: issues > 0 ? 'var(--error)' : 'var(--muted)' }}>
            {issues}
          </div>
        </div>
      </div>

      {profiles.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Profile Status</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Last Scrape</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-name">
                      <Link href={`/profiles/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>
                      <span className={`badge badge-${p.kind.toLowerCase()}`}>{p.kind}</span>
                    </td>
                    <td>
                      <span className={`status-dot status-${p.status.toLowerCase()}`} />
                      {p.status}
                    </td>
                    <td className="cell-muted">{formatDate(p.lastScrapeAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {profiles.length === 0 && (
        <section className="card" style={{ marginTop: 24 }}>
          <h3>Welcome to Scraper Dashboard v2</h3>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            No profiles yet. Go to <Link href="/profiles">Profiles</Link> to create one.
          </p>
        </section>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Profile {
  id: string;
  name: string;
  kind: string;
  loginUrl: string;
  targetUrl: string;
  buttonSelector: string;
  status: string;
  lastLoginAt: string | null;
  lastScrapeAt: string | null;
  proxy: string;
  notes: string;
  dataFields: Array<{ id: string; label: string }>;
  refreshIntervalMs: number;
  createdAt: string;
}

interface Credential {
  username: string;
  password: string;
  pin: string;
  otpEmail: string;
  totpSecret: string;
}

interface Scrape {
  id: string;
  reportDate: string;
  reportDateString: string;
  newRegistrationCount: number | null;
  newDepositCount: number | null;
  totalDepositCount: number | null;
  totalDepositAmount: string | null;
  totalWithdrawalCount: number | null;
  totalWithdrawalAmount: string | null;
  scrapedAt: string;
}

interface FetchResult {
  loggedIn: boolean;
  accessDenied?: boolean;
  parsed?: {
    data: Record<string, number | null>;
    reportDateString: string;
    fallback?: boolean;
  };
  error?: string;
  message?: string;
  url?: string;
  tables?: Array<{ headers: string[]; rowCount: number }>;
  fields?: Record<string, string | null>;
  cached?: boolean;
  scrape?: any;
}

const METRIC_LABELS: Record<string, string> = {
  newRegistrationCount: 'New Registrations',
  newDepositCount: 'New Deposits',
  totalDepositCount: 'Total Deposits',
  totalDepositAmount: 'Deposit Amount',
  totalWithdrawalCount: 'Total Withdrawals',
  totalWithdrawalAmount: 'Withdrawal Amount',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
}

function formatAmount(v: string | number | null) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNum(v: number | null | undefined) {
  if (v == null) return '—';
  return v.toLocaleString('en-US');
}

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, hasPrivilege } = useAuth();
  const canEdit = hasPrivilege('profiles.edit');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [scrapes, setScrapes] = useState<Scrape[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState('');
  const [loginLoading, setLoginLoading] = useState('');
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);

  const [showCred, setShowCred] = useState<Record<string, boolean>>({});
  const [editingCred, setEditingCred] = useState(false);
  const [credForm, setCredForm] = useState({ username: '', password: '', pin: '', otpEmail: '', totpSecret: '' });

  useEffect(() => {
    Promise.all([
      api.get<Profile>(`/profiles/${id}`),
      api.get<Credential>(`/profiles/${id}/credentials`).catch(() => null),
      api.get<Scrape[]>(`/scrapes/profile/${id}?limit=30`).catch(() => []),
    ])
      .then(([p, c, s]) => {
        setProfile(p);
        setCredential(c);
        setScrapes(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleFetch(period: 'today' | 'yesterday') {
    setFetching(period);
    setError('');
    setFetchResult(null);
    try {
      const result = await api.post<FetchResult>(`/profiles/${id}/fetch`, { period });
      setFetchResult(result);
      const s = await api.get<Scrape[]>(`/scrapes/profile/${id}?limit=30`).catch(() => []);
      setScrapes(s);
      const p = await api.get<Profile>(`/profiles/${id}`);
      setProfile(p);
    } catch (e: any) {
      setError(e.message || 'Fetch failed');
    } finally {
      setFetching('');
    }
  }

  async function handleSaveCred(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.put(`/profiles/${id}/credentials`, credForm);
      const c = await api.get<Credential>(`/profiles/${id}/credentials`).catch(() => null);
      setCredential(c);
      setEditingCred(false);
    } catch (err: any) {
      setError(err.message || 'Save failed');
    }
  }

  async function handleLogin() {
    setLoginLoading('open');
    setError('');
    try {
      await api.post(`/profiles/${id}/login`, {});
      const p = await api.get<Profile>(`/profiles/${id}`);
      setProfile(p);
    } catch (e: any) {
      setError(e.message || 'Login failed');
    } finally {
      setLoginLoading('');
    }
  }

  async function handleLoginFinish() {
    setLoginLoading('finish');
    setError('');
    try {
      await api.post(`/profiles/${id}/login/finish`, {});
      const p = await api.get<Profile>(`/profiles/${id}`);
      setProfile(p);
    } catch (e: any) {
      setError(e.message || 'Login finish failed');
    } finally {
      setLoginLoading('');
    }
  }

  async function handleLoginCancel() {
    setLoginLoading('cancel');
    try {
      await api.post(`/profiles/${id}/login/cancel`, {});
    } catch {}
    setLoginLoading('');
  }

  function toggleShow(field: string) {
    setShowCred((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  function maskValue(val: string, field: string) {
    if (!val) return '—';
    return showCred[field] ? val : '••••••••';
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!profile) return <div className="error-msg">Profile not found</div>;

  return (
    <div>
      <div className="mb-5">
        <Link href="/profiles" className="text-muted text-sm">
          ← Back to Profiles
        </Link>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      <div className="detail-grid">
        <div className="card">
          <div className="detail-header">
            <div>
              <h3 className="text-xl font-bold">{profile.name}</h3>
              <span className={`badge badge-${profile.kind.toLowerCase()}`}>{profile.kind}</span>
            </div>
            <div className="detail-status">
              <span className={`status-dot status-${profile.status.toLowerCase()}`} />
              {profile.status}
            </div>
          </div>

          <div className="detail-fields">
            <div className="detail-field">
              <span className="detail-label">Login URL</span>
              <span className="detail-value">{profile.loginUrl}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Target URL</span>
              <span className="detail-value">{profile.targetUrl}</span>
            </div>
            {profile.buttonSelector && (
              <div className="detail-field">
                <span className="detail-label">Button Selector</span>
                <span className="detail-value"><code>{profile.buttonSelector}</code></span>
              </div>
            )}
            <div className="detail-field">
              <span className="detail-label">Last Login</span>
              <span className="detail-value">{formatDate(profile.lastLoginAt)}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">Last Scrape</span>
              <span className="detail-value">{formatDate(profile.lastScrapeAt)}</span>
            </div>
            {profile.proxy && (
              <div className="detail-field">
                <span className="detail-label">Proxy</span>
                <span className="detail-value">{profile.proxy}</span>
              </div>
            )}
            {profile.notes && (
              <div className="detail-field">
                <span className="detail-label">Notes</span>
                <span className="detail-value">{profile.notes}</span>
              </div>
            )}
            <div className="detail-field">
              <span className="detail-label">Refresh Interval</span>
              <span className="detail-value">{Math.round(profile.refreshIntervalMs / 60000)} min</span>
            </div>
            {Array.isArray(profile.dataFields) && profile.dataFields.length > 0 && (
              <div className="detail-field">
                <span className="detail-label">Data Fields</span>
                <span className="detail-value">
                  {profile.dataFields.map(f => `${f.label} (#${f.id})`).join(', ')}
                </span>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="detail-actions">
              <button
                className="btn btn-primary"
                disabled={!!loginLoading}
                onClick={handleLogin}
              >
                {loginLoading === 'open' ? 'Opening…' : 'Login'}
              </button>
              <button
                className="btn btn-ghost"
                disabled={!!loginLoading}
                onClick={handleLoginFinish}
              >
                {loginLoading === 'finish' ? 'Saving…' : 'Finish Login'}
              </button>
              <button
                className="btn btn-ghost"
                disabled={!!loginLoading}
                onClick={handleLoginCancel}
              >
                Cancel Login
              </button>
            </div>
          )}

          {canEdit && (
            <div className="detail-actions mt-2">
              <button
                className="btn btn-primary"
                disabled={!!fetching}
                onClick={() => handleFetch('today')}
              >
                {fetching === 'today' ? 'Fetching…' : 'Fetch Today'}
              </button>
              <button
                className="btn btn-ghost"
                disabled={!!fetching}
                onClick={() => handleFetch('yesterday')}
              >
                {fetching === 'yesterday' ? 'Fetching…' : 'Fetch Yesterday'}
              </button>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-base font-semibold">Credentials</h4>
              {credential && !editingCred && (
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  setCredForm({
                    username: credential.username || '',
                    password: credential.password || '',
                    pin: credential.pin || '',
                    otpEmail: credential.otpEmail || '',
                    totpSecret: credential.totpSecret || '',
                  });
                  setEditingCred(true);
                }}>Edit</button>
              )}
            </div>

            {editingCred ? (
              <form onSubmit={handleSaveCred} className="flex flex-col gap-3.5">
                <label><span>Username</span><input value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })} /></label>
                <label><span>Password</span><input value={credForm.password} onChange={(e) => setCredForm({ ...credForm, password: e.target.value })} /></label>
                <label><span>PIN</span><input value={credForm.pin} onChange={(e) => setCredForm({ ...credForm, pin: e.target.value })} /></label>
                <label><span>OTP Email</span><input value={credForm.otpEmail} onChange={(e) => setCredForm({ ...credForm, otpEmail: e.target.value })} /></label>
                <label><span>TOTP Secret (2FA)</span><input type="password" value={credForm.totpSecret} onChange={(e) => setCredForm({ ...credForm, totpSecret: e.target.value })} autoComplete="off" /></label>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setEditingCred(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save</button>
                </div>
              </form>
            ) : credential ? (
              <div className="cred-list">
                <div className="cred-row">
                  <span className="cred-label">Username</span>
                  <span className="cred-value" onClick={() => toggleShow('username')}>{maskValue(credential.username, 'username')}</span>
                </div>
                <div className="cred-row">
                  <span className="cred-label">Password</span>
                  <span className="cred-value" onClick={() => toggleShow('password')}>{maskValue(credential.password, 'password')}</span>
                </div>
                <div className="cred-row">
                  <span className="cred-label">PIN</span>
                  <span className="cred-value" onClick={() => toggleShow('pin')}>{maskValue(credential.pin, 'pin')}</span>
                </div>
                <div className="cred-row">
                  <span className="cred-label">OTP Email</span>
                  <span className="cred-value">{credential.otpEmail || '—'}</span>
                </div>
                <div className="cred-row">
                  <span className="cred-label">TOTP Secret</span>
                  <span className="cred-value" onClick={() => toggleShow('totpSecret')}>{maskValue(credential.totpSecret, 'totpSecret')}</span>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-muted mb-3">No credentials set.</p>
                <button className="btn btn-sm btn-primary" onClick={() => setEditingCred(true)}>Add Credentials</button>
              </div>
            )}
          </div>
        )}
      </div>

      {fetchResult && (
        <div className="fetch-result-panel">
          <div className="fetch-result-header">
            <h4>
              {fetchResult.loggedIn === false
                ? fetchResult.accessDenied
                  ? 'Access Denied'
                  : 'Session Expired'
                : fetchResult.parsed
                  ? `Fetch Result — ${fetchResult.parsed.reportDateString}`
                  : 'No Data Parsed'}
            </h4>
            <button className="btn btn-sm btn-ghost" onClick={() => setFetchResult(null)}>
              Dismiss
            </button>
          </div>

          {fetchResult.loggedIn === false ? (
            <div className={`text-sm ${fetchResult.accessDenied ? 'text-error' : 'text-warning'}`}>
              {fetchResult.accessDenied
                ? 'The account was bounced to an Access-Denied page. Re-login this profile, or check its account permission / IP allowlist.'
                : 'Session expired. Click Login above to re-authenticate.'}
              {fetchResult.url && (
                <div className="mt-2 text-muted text-xs">
                  Landing URL: {fetchResult.url}
                </div>
              )}
            </div>
          ) : fetchResult.parsed ? (
            <>
              <div className="fetch-result-metrics">
                {Object.entries(METRIC_LABELS).map(([key, label]) => (
                  <div key={key} className="fetch-metric">
                    <div className="fetch-metric-label">{label}</div>
                    <div className={`fetch-metric-value ${key.includes('Amount') ? 'text-accent' : 'text-[var(--text)]'}`}>
                      {key.includes('Amount')
                        ? formatAmount(fetchResult.parsed!.data[key])
                        : formatNum(fetchResult.parsed!.data[key])}
                    </div>
                  </div>
                ))}
              </div>
              {fetchResult.parsed.fallback && (
                <div className="fetch-note">
                  Showing nearest available date (fallback) — today&apos;s data not yet available at this cutover time.
                </div>
              )}
              {fetchResult.cached && (
                <div className="fetch-note">
                  Loaded from archive (previously scraped data).
                </div>
              )}
            </>
          ) : (
            <div className="text-muted text-sm">
              Logged in, but no data could be parsed from the page.
              {fetchResult.tables && (
                <div className="mt-2">
                  Found {fetchResult.tables.length} table{fetchResult.tables.length !== 1 ? 's' : ''} on the page.
                  {fetchResult.tables.length === 0 && (
                    <span> Check that the target URL points to the correct report page.</span>
                  )}
                </div>
              )}
              {fetchResult.fields && Object.keys(fetchResult.fields).length > 0 && (
                <div className="mt-2">
                  Extracted {Object.keys(fetchResult.fields).length} data field{Object.keys(fetchResult.fields).length !== 1 ? 's' : ''}.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <section className="mt-6">
        <h4 className="text-base font-semibold mb-3">Recent Scrapes</h4>
        {scrapes.length === 0 ? (
          <div className="empty-state"><p>No scrape data yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>New Reg.</th>
                  <th>New Dep.</th>
                  <th>Total Dep.</th>
                  <th>Dep. Amount</th>
                  <th>Total Wdr.</th>
                  <th>Wdr. Amount</th>
                  <th>Scraped At</th>
                </tr>
              </thead>
              <tbody>
                {scrapes.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-name">{s.reportDateString}</td>
                    <td>{s.newRegistrationCount ?? '—'}</td>
                    <td>{s.newDepositCount ?? '—'}</td>
                    <td>{s.totalDepositCount ?? '—'}</td>
                    <td>{formatAmount(s.totalDepositAmount)}</td>
                    <td>{s.totalWithdrawalCount ?? '—'}</td>
                    <td>{formatAmount(s.totalWithdrawalAmount)}</td>
                    <td className="cell-muted">{formatDate(s.scrapedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

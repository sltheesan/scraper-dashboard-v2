'use client';

import { useEffect, useState, useMemo, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface Profile {
  id: string;
  name: string;
  kind: 'CGAMING' | 'ZOOMWLB';
  loginUrl: string;
  targetUrl: string;
  buttonSelector: string;
  proxy: string;
  notes: string;
  status: string;
  lastScrapeAt: string | null;
  createdAt: string;
  refreshIntervalMs?: number;
  dataFields?: DataField[];
}

interface ScrapeData {
  reportDateString?: string;
  reportDate?: string;
  newRegistrationCount?: number;
  newDepositCount?: number;
  totalDepositCount?: number;
  totalDepositAmount?: number;
  totalWithdrawalCount?: number;
  totalWithdrawalAmount?: number;
}

interface FetchResultData {
  profileName: string;
  profileKind: string;
  period: string;
  loggedIn?: boolean;
  error?: string;
  accessDenied?: boolean;
  cached?: boolean;
  scrape?: ScrapeData;
}

function formatReportDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

function fmt(n?: number | string): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-US');
}

interface DataField {
  id: string;
  label: string;
}

const EMPTY_FORM = {
  name: '',
  kind: 'CGAMING' as 'CGAMING' | 'ZOOMWLB',
  loginUrl: '',
  targetUrl: '',
  buttonSelector: '',
  proxy: '',
  notes: '',
  refreshIntervalMs: 300000,
  dataFields: [] as DataField[],
  otpEmail: '',
  credUsername: '',
  credPassword: '',
  credPin: '',
};

const PAGE_SIZE = 20;

export default function ProfilesPage() {
  const { user, hasPrivilege } = useAuth();
  const canEdit = hasPrivilege('profiles.edit');
  const canDelete = hasPrivilege('profiles.delete');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | 'CGAMING' | 'ZOOMWLB'>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

  async function loadProfiles() {
    try {
      const data = await api.get<Profile[]>('/profiles');
      setProfiles(data);
    } catch {
      setError('Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  const filtered = useMemo(() => {
    let list = profiles;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.loginUrl.toLowerCase().includes(q) ||
          p.targetUrl.toLowerCase().includes(q),
      );
    }
    if (kindFilter) list = list.filter((p) => p.kind === kindFilter);
    if (statusFilter) list = list.filter((p) => p.status === statusFilter);
    return list;
  }, [profiles, search, kindFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, kindFilter, statusFilter]);

  const statuses = useMemo(() => [...new Set(profiles.map((p) => p.status))].sort(), [profiles]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setError('');
  }

  async function openEdit(p: Profile) {
    let cred = { username: '', password: '', pin: '', otpEmail: '' };
    try {
      cred = await api.get(`/profiles/${p.id}/credentials`);
    } catch {}
    setForm({
      name: p.name,
      kind: p.kind,
      loginUrl: p.loginUrl,
      targetUrl: p.targetUrl,
      buttonSelector: p.buttonSelector || '',
      proxy: p.proxy || '',
      notes: p.notes || '',
      refreshIntervalMs: p.refreshIntervalMs ?? 300000,
      dataFields: Array.isArray(p.dataFields) ? p.dataFields : [],
      otpEmail: cred.otpEmail || '',
      credUsername: cred.username || '',
      credPassword: cred.password || '',
      credPin: cred.pin || '',
    });
    setEditingId(p.id);
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { otpEmail, credUsername, credPassword, credPin, ...profileData } = form;
      let profileId = editingId;
      if (editingId) {
        await api.patch(`/profiles/${editingId}`, profileData);
      } else {
        const created = await api.post<Profile>('/profiles', profileData);
        profileId = created.id;
      }
      if (profileId && (credUsername || credPassword || credPin || otpEmail)) {
        await api.put(`/profiles/${profileId}/credentials`, {
          username: credUsername,
          password: credPassword,
          pin: credPin,
          otpEmail,
        });
      }
      setShowForm(false);
      setEditingId(null);
      await loadProfiles();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    }
  }

  const [busyActions, setBusyActions] = useState<Record<string, string>>({});
  const [loginSession, setLoginSession] = useState<{
    id: string; name: string; alreadyOpen: boolean;
    cred?: { username: string; password: string; pin: string; otpEmail: string };
  } | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [otpResult, setOtpResult] = useState<{ otp: string | null; subject?: string; from?: string; receivedAt?: string } | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [copied, setCopied] = useState('');
  const [fetchResult, setFetchResult] = useState<FetchResultData | null>(null);

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  }

  async function handleLogin(profile: Profile) {
    setBusyActions((prev) => ({ ...prev, [profile.id]: 'login' }));
    try {
      const [result, cred] = await Promise.all([
        api.post<{ ok: boolean; alreadyOpen: boolean }>(`/profiles/${profile.id}/login`),
        api.get<{ username: string; password: string; pin: string; otpEmail: string }>(
          `/profiles/${profile.id}/credentials`,
        ).catch(() => null),
      ]);
      setOtpResult(null);
      setOtpError('');
      setCopied('');
      setLoginSession({
        id: profile.id,
        name: profile.name,
        alreadyOpen: result.alreadyOpen,
        cred: cred || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setBusyActions((prev) => {
        const next = { ...prev };
        delete next[profile.id];
        return next;
      });
    }
  }

  async function handleLoginSave() {
    if (!loginSession) return;
    setLoginBusy(true);
    try {
      await api.post(`/profiles/${loginSession.id}/login/finish`);
      setLoginSession(null);
      await loadProfiles();
    } catch (err: any) {
      setError(err.message || 'Save session failed');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLoginCancel() {
    if (!loginSession) return;
    setLoginBusy(true);
    try {
      await api.post(`/profiles/${loginSession.id}/login/cancel`);
    } catch {}
    setLoginSession(null);
    setLoginBusy(false);
  }

  async function handleGetOtp() {
    if (!loginSession) return;
    setOtpBusy(true);
    setOtpError('');
    setOtpResult(null);
    try {
      const res = await api.post<{ result: any }>(`/profiles/${loginSession.id}/credentials/otp`);
      if (res.result) {
        setOtpResult(res.result);
      } else {
        setOtpError('No OTP found in recent emails (last 10 minutes)');
      }
    } catch (err: any) {
      setOtpError(err.message || 'Failed to fetch OTP');
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleAction(id: string, action: string, body?: any) {
    const profile = profiles.find((p) => p.id === id);
    const period = body?.period || 'today';
    setBusyActions((prev) => ({ ...prev, [id]: action }));
    try {
      const result = await api.post<any>(`/profiles/${id}/${action}`, body);
      await loadProfiles();
      if (action === 'fetch') {
        setFetchResult({
          profileName: profile?.name || id,
          profileKind: profile?.kind || '',
          period,
          loggedIn: result.loggedIn,
          error: result.error,
          accessDenied: result.accessDenied,
          cached: result.cached,
          scrape: result.scrape,
        });
      }
    } catch (err: any) {
      setError(err.message || `${action} failed`);
    } finally {
      setBusyActions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete profile "${name}"?`)) return;
    try {
      await api.delete(`/profiles/${id}`);
      await loadProfiles();
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-actions">
        <div className="filter-bar">
          <input
            className="filter-search"
            placeholder="Search profiles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="filter-select"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as any)}
          >
            <option value="">All kinds</option>
            <option value="CGAMING">CGaming</option>
            <option value="ZOOMWLB">ZoomWLB</option>
          </select>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={openCreate}>
            + New Profile
          </button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <form
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <h3>{editingId ? 'Edit Profile' : 'New Profile'}</h3>

            <div className="form-grid">
              <label>
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="e.g. Agent-01"
                />
              </label>

              <label>
                <span>Kind</span>
                <select
                  value={form.kind}
                  onChange={(e) =>
                    setForm({ ...form, kind: e.target.value as 'CGAMING' | 'ZOOMWLB' })
                  }
                >
                  <option value="CGAMING">CGaming</option>
                  <option value="ZOOMWLB">ZoomWLB</option>
                </select>
              </label>

              <label>
                <span>Login URL</span>
                <input
                  value={form.loginUrl}
                  onChange={(e) => setForm({ ...form, loginUrl: e.target.value })}
                  required
                  placeholder="https://..."
                />
              </label>

              <label>
                <span>Target URL</span>
                <input
                  value={form.targetUrl}
                  onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
                  required
                  placeholder="https://..."
                />
              </label>

              <label>
                <span>Button Selector</span>
                <input
                  value={form.buttonSelector}
                  onChange={(e) => setForm({ ...form, buttonSelector: e.target.value })}
                  placeholder="e.g. #btnSubmit"
                />
              </label>

              <label>
                <span>Proxy</span>
                <input
                  value={form.proxy}
                  onChange={(e) => setForm({ ...form, proxy: e.target.value })}
                  placeholder="socks5://host:port"
                />
              </label>

              <label>
                <span>Notes</span>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes..."
                />
              </label>

              <label>
                <span>Refresh Interval (minutes)</span>
                <input
                  type="number"
                  min={1}
                  value={Math.round(form.refreshIntervalMs / 60000)}
                  onChange={(e) =>
                    setForm({ ...form, refreshIntervalMs: Number(e.target.value) * 60000 })
                  }
                />
              </label>

              <div className="form-full" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 12 }}>
                  Credentials
                </span>
                <div className="form-grid">
                  <label>
                    <span>Username</span>
                    <input
                      value={form.credUsername}
                      onChange={(e) => setForm({ ...form, credUsername: e.target.value })}
                      placeholder="Login username"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>Password</span>
                    <input
                      type="password"
                      value={form.credPassword}
                      onChange={(e) => setForm({ ...form, credPassword: e.target.value })}
                      placeholder="Login password"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>PIN</span>
                    <input
                      value={form.credPin}
                      onChange={(e) => setForm({ ...form, credPin: e.target.value })}
                      placeholder="Optional PIN"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>OTP Email</span>
                    <input
                      type="email"
                      value={form.otpEmail}
                      onChange={(e) => setForm({ ...form, otpEmail: e.target.value })}
                      placeholder="e.g. autoceknawala@gmail.com"
                    />
                  </label>
                </div>
              </div>

              <div className="data-fields-editor form-full">
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  Data Fields
                </span>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
                  Element IDs on the page to scrape values from.
                </p>
                {form.dataFields.map((df, i) => (
                  <div key={i} className="data-field-row">
                    <input
                      placeholder="Element ID"
                      value={df.id}
                      onChange={(e) => {
                        const next = [...form.dataFields];
                        next[i] = { ...next[i], id: e.target.value };
                        setForm({ ...form, dataFields: next });
                      }}
                    />
                    <input
                      placeholder="Label"
                      value={df.label}
                      onChange={(e) => {
                        const next = [...form.dataFields];
                        next[i] = { ...next[i], label: e.target.value };
                        setForm({ ...form, dataFields: next });
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        setForm({
                          ...form,
                          dataFields: form.dataFields.filter((_, j) => j !== i),
                        });
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setForm({
                      ...form,
                      dataFields: [...form.dataFields, { id: '', label: '' }],
                    })
                  }
                >
                  + Add Field
                </button>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loginSession && (
        <div className="modal-overlay" onClick={() => {}}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3>Login session — {loginSession.name}</h3>

            {loginSession.cred ? (
              <div className="login-cred-grid">
                <div className="login-cred-row">
                  <span className="login-cred-label">Username</span>
                  <span className="login-cred-value">{loginSession.cred.username || '—'}</span>
                  {loginSession.cred.username && (
                    <button
                      className="login-cred-copy"
                      onClick={() => copyToClipboard(loginSession.cred!.username, 'username')}
                    >
                      {copied === 'username' ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                <div className="login-cred-row">
                  <span className="login-cred-label">Password</span>
                  <span className="login-cred-value">{'•'.repeat(loginSession.cred.password?.length || 0) || '—'}</span>
                  {loginSession.cred.password && (
                    <button
                      className="login-cred-copy"
                      onClick={() => copyToClipboard(loginSession.cred!.password, 'password')}
                    >
                      {copied === 'password' ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                {loginSession.cred.pin && (
                  <div className="login-cred-row">
                    <span className="login-cred-label">PIN</span>
                    <span className="login-cred-value">{'•'.repeat(loginSession.cred.pin.length)}</span>
                    <button
                      className="login-cred-copy"
                      onClick={() => copyToClipboard(loginSession.cred!.pin, 'pin')}
                    >
                      {copied === 'pin' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
                No credentials saved for this profile.
              </p>
            )}

            <ol style={{ margin: '0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--muted)', fontSize: 13 }}>
              <li>Complete the login in the browser window on the server.</li>
              <li>Come back here and click <strong>Save session</strong>.</li>
            </ol>
            {loginSession.alreadyOpen && (
              <p style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 13 }}>
                A login window for this profile is already open.
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--warning, #d97706)', color: '#fff', border: 'none' }}
                disabled={otpBusy}
                onClick={handleGetOtp}
              >
                {otpBusy ? 'Fetching...' : 'Get OTP'}
              </button>
              {otpResult?.otp && (
                <span className="login-otp-code" onClick={() => copyToClipboard(otpResult.otp!, 'otp')}>
                  {otpResult.otp}
                  <span className="login-otp-copy">{copied === 'otp' ? 'Copied' : 'Click to copy'}</span>
                </span>
              )}
              {otpError && (
                <span style={{ fontSize: 13, color: 'var(--error, #ef4444)' }}>{otpError}</span>
              )}
            </div>
            {otpResult && !otpResult.otp && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                No OTP code found in recent emails.
              </p>
            )}

            <div className="form-actions">
              <button
                className="btn btn-ghost"
                disabled={loginBusy}
                onClick={handleLoginCancel}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={loginBusy}
                onClick={handleLoginSave}
              >
                {loginBusy ? 'Saving...' : 'Save session'}
              </button>
            </div>
          </div>
        </div>
      )}

      {fetchResult && (
        <div className="modal-overlay" onClick={() => setFetchResult(null)}>
          <div className="fetch-card" onClick={(e) => e.stopPropagation()}>
            <div className="fetch-card-head">
              <div>
                <div className="fetch-card-name">{fetchResult.profileName}</div>
                <div className="fetch-card-sub">
                  {fetchResult.period === 'yesterday' ? 'Yesterday' : 'Today'}
                  {fetchResult.scrape?.reportDate && <> · {formatReportDate(fetchResult.scrape.reportDate)}</>}
                  {' '}ICT
                  {fetchResult.cached && <span className="fetch-card-cached">cached</span>}
                </div>
              </div>
              <span className={`badge badge-${fetchResult.profileKind.toLowerCase()}`}>
                {fetchResult.profileKind}
              </span>
            </div>

            {fetchResult.loggedIn === false ? (
              <div className="fetch-result-error">
                <span className="fetch-result-icon">⚠</span>
                <div>
                  <strong>{fetchResult.accessDenied ? 'Access Denied' : 'Session Expired'}</strong>
                  <p>
                    {fetchResult.accessDenied
                      ? 'The profile was denied access. Please check the account status.'
                      : 'The profile is logged out. Please login first.'}
                  </p>
                </div>
              </div>
            ) : fetchResult.error ? (
              <div className="fetch-result-error">
                <span className="fetch-result-icon">✕</span>
                <div>
                  <strong>Fetch Error</strong>
                  <p>{fetchResult.error}</p>
                </div>
              </div>
            ) : fetchResult.scrape ? (
              <div className="fetch-card-grid">
                <div className="fetch-card-metric">
                  <span className="fetch-card-label">New Registration Count</span>
                  <span className="fetch-card-value">{fmt(fetchResult.scrape.newRegistrationCount)}</span>
                </div>
                <div className="fetch-card-metric">
                  <span className="fetch-card-label">New Deposit Count</span>
                  <span className="fetch-card-value">{fmt(fetchResult.scrape.newDepositCount)}</span>
                </div>
                <div className="fetch-card-metric">
                  <span className="fetch-card-label">Total Deposit Count</span>
                  <span className="fetch-card-value">{fmt(fetchResult.scrape.totalDepositCount)}</span>
                </div>
                <div className="fetch-card-metric">
                  <span className="fetch-card-label">Total Deposit Amount</span>
                  <span className="fetch-card-value amount">{fmt(fetchResult.scrape.totalDepositAmount)}</span>
                </div>
                <div className="fetch-card-metric">
                  <span className="fetch-card-label">Total Withdrawal Count</span>
                  <span className="fetch-card-value">{fmt(fetchResult.scrape.totalWithdrawalCount)}</span>
                </div>
                <div className="fetch-card-metric">
                  <span className="fetch-card-label">Total Withdrawal Amount</span>
                  <span className="fetch-card-value amount">{fmt(fetchResult.scrape.totalWithdrawalAmount)}</span>
                </div>
              </div>
            ) : (
              <div className="fetch-result-error">
                <span className="fetch-result-icon">—</span>
                <div>
                  <strong>No Data</strong>
                  <p>No scrape data was returned for this period.</p>
                </div>
              </div>
            )}

            <div className="fetch-card-foot">
              <span className="fetch-card-dot" /> Scraper Dashboard · live fetch
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setFetchResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {profiles.length === 0 ? (
        <div className="empty-state">
          <p>No profiles yet.</p>
          {canEdit && <p>Click &quot;+ New Profile&quot; to create one.</p>}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Target URL</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Last Scrape</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-name">
                      <Link href={`/profiles/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {p.name}
                      </Link>
                    </td>
                    <td className="cell-muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.targetUrl}
                    </td>
                    <td>
                      <span className={`badge badge-${p.kind.toLowerCase()}`}>
                        {p.kind}
                      </span>
                    </td>
                    <td>
                      <span className={`status-dot status-${p.status.toLowerCase()}`} />
                      {p.status}
                    </td>
                    <td className="cell-muted">
                      {p.lastScrapeAt
                        ? new Date(p.lastScrapeAt).toLocaleString('en-GB', {
                            timeZone: 'Asia/Bangkok',
                          })
                        : '—'}
                    </td>
                    <td className="cell-actions">
                      {canEdit && (
                        <>
                          <button
                            className="btn btn-sm"
                            disabled={!!busyActions[p.id]}
                            onClick={() => handleLogin(p)}
                          >
                            {busyActions[p.id] === 'login' ? '...' : 'Login'}
                          </button>
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={!!busyActions[p.id]}
                            onClick={() => handleAction(p.id, 'fetch', { period: 'today' })}
                          >
                            {busyActions[p.id] === 'fetch' ? '...' : 'Fetch'}
                          </button>
                          <button
                            className="btn btn-sm"
                            disabled={!!busyActions[p.id]}
                            onClick={() => handleAction(p.id, 'fetch', { period: 'yesterday' })}
                          >
                            {busyActions[p.id] ? '...' : 'Yesterday'}
                          </button>
                          <button className="btn btn-sm" onClick={() => openEdit(p)}>
                            Edit
                          </button>
                        </>
                      )}
                      {canDelete && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(p.id, p.name)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <button
                className="btn btn-sm btn-ghost"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Prev
              </button>
              <span className="pagination-info">
                Page {safePage + 1} of {pageCount} ({filtered.length} profiles)
              </span>
              <button
                className="btn btn-sm btn-ghost"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

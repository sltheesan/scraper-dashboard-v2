'use client';

import { useEffect, useState, useMemo, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';

interface Profile {
  id: string;
  name: string;
  kind: 'CGAMING' | 'ZOOMWLB' | 'ONEOPSPORTAL';
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
  kind: 'CGAMING' as 'CGAMING' | 'ZOOMWLB' | 'ONEOPSPORTAL',
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
  credTotpSecret: '',
};

const PAGE_SIZE = 20;

export default function ProfilesPage() {
  const { user, hasPrivilege } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPrivilege('profiles.edit');
  const canDelete = hasPrivilege('profiles.delete');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | 'CGAMING' | 'ZOOMWLB' | 'ONEOPSPORTAL'>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

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

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

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

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va: any;
      let vb: any;
      switch (sortKey) {
        case 'name':
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
          break;
        case 'kind':
          va = a.kind;
          vb = b.kind;
          break;
        case 'status':
          va = a.status;
          vb = b.status;
          break;
        case 'lastScrapeAt':
          va = a.lastScrapeAt || '';
          vb = b.lastScrapeAt || '';
          break;
        case 'targetUrl':
          va = a.targetUrl.toLowerCase();
          vb = b.targetUrl.toLowerCase();
          break;
        default:
          return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  useEffect(() => { setPage(0); }, [search, kindFilter, statusFilter]);

  const statuses = useMemo(() => [...new Set(profiles.map((p) => p.status))].sort(), [profiles]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setError('');
  }

  async function openEdit(p: Profile) {
    let cred = { username: '', password: '', pin: '', otpEmail: '', totpSecret: '' };
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
      credTotpSecret: cred.totpSecret || '',
    });
    setEditingId(p.id);
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { otpEmail, credUsername, credPassword, credPin, credTotpSecret, ...profileData } = form;
      let profileId = editingId;
      if (editingId) {
        await api.patch(`/profiles/${editingId}`, profileData);
      } else {
        const created = await api.post<Profile>('/profiles', profileData);
        profileId = created.id;
      }
      if (profileId && (credUsername || credPassword || credPin || otpEmail || credTotpSecret)) {
        await api.put(`/profiles/${profileId}/credentials`, {
          username: credUsername,
          password: credPassword,
          pin: credPin,
          otpEmail,
          totpSecret: credTotpSecret,
        });
      }
      setShowForm(false);
      setEditingId(null);
      toast(editingId ? 'Profile updated' : 'Profile created', 'success');
      await loadProfiles();
    } catch (err: any) {
      setError(err.message || 'Save failed');
      toast(err.message || 'Save failed', 'error');
    }
  }

  const [busyActions, setBusyActions] = useState<Record<string, string>>({});
  const [loginSession, setLoginSession] = useState<{
    id: string; name: string; alreadyOpen: boolean;
    cred?: { username: string; password: string; pin: string; otpEmail: string; totpSecret: string };
  } | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [otpResult, setOtpResult] = useState<{ otp: string | null; subject?: string; from?: string; receivedAt?: string } | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [totpResult, setTotpResult] = useState<{ code: string; remainingSeconds: number } | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState('');
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
        api.post<{ ok: boolean; alreadyOpen: boolean }>(`/profiles/${profile.id}/login`, {}),
        api.get<{ username: string; password: string; pin: string; otpEmail: string; totpSecret: string }>(
          `/profiles/${profile.id}/credentials`,
        ).catch(() => null),
      ]);
      setOtpResult(null);
      setOtpError('');
      setTotpResult(null);
      setTotpError('');
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
      await api.post(`/profiles/${loginSession.id}/login/finish`, {});
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
      await api.post(`/profiles/${loginSession.id}/login/cancel`, {});
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
      const res = await api.post<{ result: any }>(`/profiles/${loginSession.id}/credentials/otp`, {});
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

  async function handleGetTotp() {
    if (!loginSession) return;
    setTotpBusy(true);
    setTotpError('');
    setTotpResult(null);
    try {
      const res = await api.post<{ code: string; remainingSeconds: number }>(
        `/profiles/${loginSession.id}/credentials/totp`,
        {},
      );
      setTotpResult(res);
    } catch (err: any) {
      setTotpError(err.message || 'Failed to generate 2FA code');
    } finally {
      setTotpBusy(false);
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

  if (loading) return <div className="flex items-center justify-center py-20"><div className="spinner" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-0">
          <input
            className="bg-surface border border-border rounded-sm px-3 py-2 text-sm text-[var(--text)] placeholder:text-muted/60 focus:border-accent outline-none flex-1 min-w-0 sm:max-w-[260px]"
            placeholder="Search profiles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="bg-surface border border-border rounded-sm px-2 py-2 text-sm text-[var(--text)] cursor-pointer min-w-[120px]"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as any)}
          >
            <option value="">All kinds</option>
            <option value="CGAMING">CGaming</option>
            <option value="ZOOMWLB">ZoomWLB</option>
            <option value="ONEOPSPORTAL">OneOpsPortal</option>
          </select>
          <select
            className="bg-surface border border-border rounded-sm px-2 py-2 text-sm text-[var(--text)] cursor-pointer min-w-[120px]"
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
          <button className="btn btn-primary whitespace-nowrap" onClick={openCreate}>
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
                    setForm({ ...form, kind: e.target.value as 'CGAMING' | 'ZOOMWLB' | 'ONEOPSPORTAL' })
                  }
                >
                  <option value="CGAMING">CGaming</option>
                  <option value="ZOOMWLB">ZoomWLB</option>
                  <option value="ONEOPSPORTAL">OneOpsPortal</option>
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

              <div className="form-full border-t border-border pt-4 mt-1">
                <span className="text-sm font-semibold block mb-3">
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
                  <label>
                    <span>TOTP Secret (2FA)</span>
                    <input
                      type="password"
                      value={form.credTotpSecret}
                      onChange={(e) => setForm({ ...form, credTotpSecret: e.target.value })}
                      placeholder="Base32 secret from QR code"
                      autoComplete="off"
                    />
                  </label>
                </div>
              </div>

              <div className="data-fields-editor form-full">
                <span className="text-sm font-semibold">
                  Data Fields
                </span>
                <p className="text-xs text-muted mt-1 mb-2">
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
          <div className="modal-card max-w-[500px]" onClick={(e) => e.stopPropagation()}>
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
              <p className="text-[13px] text-muted italic">
                No credentials saved for this profile.
              </p>
            )}

            <ol className="m-0 pl-5 flex flex-col gap-1.5 text-muted text-[13px]">
              <li>Click <strong>View Browser</strong> to open the remote browser window.</li>
              <li>Complete the login in the browser.</li>
              <li>Come back here and click <strong>Save session</strong>.</li>
            </ol>
            {loginSession.alreadyOpen && (
              <p className="text-muted italic text-[13px]">
                A login window for this profile is already open.
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              {loginSession.cred?.totpSecret && (
                <>
                  <button
                    className="btn btn-sm bg-accent text-white border-none"
                    disabled={totpBusy}
                    onClick={handleGetTotp}
                  >
                    {totpBusy ? 'Generating...' : 'Get 2FA Code'}
                  </button>
                  {totpResult && (
                    <span className="login-otp-code" onClick={() => copyToClipboard(totpResult.code, 'totp')}>
                      {totpResult.code}
                      <span className="login-otp-copy">
                        {copied === 'totp' ? 'Copied' : `${totpResult.remainingSeconds}s · Click to copy`}
                      </span>
                    </span>
                  )}
                  {totpError && (
                    <span className="text-[13px] text-error">{totpError}</span>
                  )}
                </>
              )}
              {loginSession.cred?.otpEmail && (
                <>
                  <button
                    className="btn btn-sm bg-warning text-white border-none"
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
                    <span className="text-[13px] text-error">{otpError}</span>
                  )}
                </>
              )}
            </div>
            {otpResult && !otpResult.otp && loginSession.cred?.otpEmail && (
              <p className="text-[13px] text-muted">
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
                className="btn btn-ghost"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={async () => {
                  try {
                    const res = await api.post<{ token: string }>('/vnc/token', { profileName: loginSession?.name });
                    window.open(`/vnc/vnc.html?token=${res.token}&autoconnect=true&resize=scale&path=vnc/websockify`, '_blank');
                  } catch (err: any) {
                    setError(err.message || 'Failed to open VNC session');
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
                View Browser
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
              <button className="btn btn-primary ml-auto" onClick={() => setFetchResult(null)}>Close</button>
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
        <div className="dt-container">
          <div className="dt-info-bar">
            <span className="dt-count">
              {sorted.length === profiles.length
                ? `${profiles.length} profiles`
                : `${sorted.length} of ${profiles.length} profiles`}
            </span>
            <label className="dt-page-size">
              Show
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          <div className="table-wrap table-sticky-header">
            <table>
              <thead>
                <tr>
                  {[
                    { key: 'name', label: 'Name', hide: '' },
                    { key: 'targetUrl', label: 'Target URL', hide: 'hidden lg:table-cell' },
                    { key: 'kind', label: 'Kind', hide: 'hidden sm:table-cell' },
                    { key: 'status', label: 'Status', hide: '' },
                    { key: 'lastScrapeAt', label: 'Last Scrape', hide: 'hidden md:table-cell' },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`dt-th ${col.hide}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="dt-th-inner">
                        {col.label}
                        <span className="dt-sort-icon">
                          {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-[var(--muted)]">
                      No profiles match your filters.
                    </td>
                  </tr>
                ) : paged.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-name">
                      <Link href={`/profiles/${p.id}`} className="text-inherit no-underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="cell-muted max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap hidden lg:table-cell">
                      {p.targetUrl}
                    </td>
                    <td className="hidden sm:table-cell">
                      <span className={`badge badge-${p.kind.toLowerCase()}`}>
                        {p.kind}
                      </span>
                    </td>
                    <td>
                      <span className={`status-dot status-${p.status.toLowerCase()}`} />
                      <span className="text-xs">{p.status.replace('_', ' ')}</span>
                    </td>
                    <td className="cell-muted hidden md:table-cell whitespace-nowrap">
                      {p.lastScrapeAt
                        ? new Date(p.lastScrapeAt).toLocaleString('en-GB', {
                            timeZone: 'Asia/Bangkok',
                          })
                        : '—'}
                    </td>
                    <td>
                      <div className="flex gap-1.5 flex-wrap">
                        {canEdit && (
                          <>
                            <button
                              className="btn btn-sm btn-ghost"
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
                              className="btn btn-sm btn-ghost hidden sm:inline-block"
                              disabled={!!busyActions[p.id]}
                              onClick={() => handleAction(p.id, 'fetch', { period: 'yesterday' })}
                            >
                              {busyActions[p.id] ? '...' : 'Yest.'}
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => openEdit(p)}>
                              Edit
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDelete(p.id, p.name)}
                          >
                            Del
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dt-footer">
            <span className="dt-range">
              {sorted.length > 0
                ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, sorted.length)} of ${sorted.length}`
                : '0 results'}
            </span>
            <div className="dt-pager">
              <button className="btn btn-sm btn-ghost" disabled={safePage === 0} onClick={() => setPage(0)}>
                «
              </button>
              <button className="btn btn-sm btn-ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                ‹
              </button>
              {Array.from({ length: pageCount }, (_, i) => i)
                .filter((i) => i === 0 || i === pageCount - 1 || Math.abs(i - safePage) <= 1)
                .reduce<(number | 'gap')[]>((acc, i) => {
                  if (acc.length && typeof acc[acc.length - 1] === 'number' && (i - (acc[acc.length - 1] as number)) > 1) {
                    acc.push('gap');
                  }
                  acc.push(i);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === 'gap' ? (
                    <span key={`gap-${idx}`} className="dt-pager-gap">…</span>
                  ) : (
                    <button
                      key={item}
                      className={`btn btn-sm ${item === safePage ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setPage(item as number)}
                    >
                      {(item as number) + 1}
                    </button>
                  ),
                )}
              <button className="btn btn-sm btn-ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                ›
              </button>
              <button className="btn btn-sm btn-ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>
                »
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

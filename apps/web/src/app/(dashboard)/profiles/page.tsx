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
};

const PAGE_SIZE = 20;

export default function ProfilesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'OPERATOR';
  const canDelete = user?.role === 'ADMIN';

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

  function openEdit(p: Profile) {
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
    });
    setEditingId(p.id);
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.patch(`/profiles/${editingId}`, form);
      } else {
        await api.post('/profiles', form);
      }
      setShowForm(false);
      setEditingId(null);
      await loadProfiles();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    }
  }

  const [busyActions, setBusyActions] = useState<Record<string, string>>({});

  async function handleAction(id: string, action: string, body?: any) {
    setBusyActions((prev) => ({ ...prev, [id]: action }));
    try {
      await api.post(`/profiles/${id}/${action}`, body);
      await loadProfiles();
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
                        <button className="btn btn-sm" onClick={() => openEdit(p)}>
                          Edit
                        </button>
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
                onClick={() => setPage(safePa
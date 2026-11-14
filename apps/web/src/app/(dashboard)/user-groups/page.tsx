'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface PrivilegeCategory {
  label: string;
  privileges: string[];
}

interface GroupRecord {
  id: string;
  name: string;
  description: string;
  privileges: string[];
  _count?: { users: number };
  users?: { id: string; email: string; name: string }[];
}

export default function UserGroupsPage() {
  const { hasPrivilege } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [categories, setCategories] = useState<Record<string, PrivilegeCategory>>({});
  const [allPrivileges, setAllPrivileges] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<GroupRecord | null>(null);
  const [form, setForm] = useState({ name: '', description: '', privileges: [] as string[] });

  useEffect(() => {
    if (!hasPrivilege('groups.manage')) {
      router.replace('/');
      return;
    }
    loadData();
  }, [hasPrivilege, router]);

  async function loadData() {
    try {
      const [g, p] = await Promise.all([
        api.get<GroupRecord[]>('/user-groups'),
        api.get<{ privileges: string[]; categories: Record<string, PrivilegeCategory> }>('/user-groups/privileges'),
      ]);
      setGroups(g);
      setAllPrivileges(p.privileges);
      setCategories(p.categories);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', privileges: [] });
  }

  function openEdit(g: GroupRecord) {
    setEditing(g);
    setForm({ name: g.name, description: g.description, privileges: [...g.privileges] });
  }

  function closeForm() {
    setEditing(null);
    setForm({ name: '', description: '', privileges: [] });
  }

  function togglePrivilege(p: string) {
    setForm((prev) => ({
      ...prev,
      privileges: prev.privileges.includes(p)
        ? prev.privileges.filter((x) => x !== p)
        : [...prev.privileges, p],
    }));
  }

  function toggleCategory(cat: PrivilegeCategory) {
    const allSelected = cat.privileges.every((p) => form.privileges.includes(p));
    if (allSelected) {
      setForm((prev) => ({
        ...prev,
        privileges: prev.privileges.filter((p) => !cat.privileges.includes(p)),
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        privileges: [...new Set([...prev.privileges, ...cat.privileges])],
      }));
    }
  }

  function selectAll() {
    setForm((prev) => ({ ...prev, privileges: [...allPrivileges] }));
  }

  function clearAll() {
    setForm((prev) => ({ ...prev, privileges: [] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.patch(`/user-groups/${editing.id}`, form);
      } else {
        await api.post('/user-groups', form);
      }
      closeForm();
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(g: GroupRecord) {
    if (!confirm(`Delete group "${g.name}"?`)) return;
    setError('');
    try {
      await api.delete(`/user-groups/${g.id}`);
      if (editing?.id === g.id) closeForm();
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const isFormOpen = editing !== null || form.name !== '' || form.privileges.length > 0;

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>{groups.length} group(s)</div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Group</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isFormOpen ? '1fr 1fr' : '1fr', gap: 20 }}>
        {/* Groups list */}
        <div>
          {groups.length === 0 ? (
            <div className="empty-state"><p>No user groups yet. Create one to get started.</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="card"
                  style={{
                    padding: 16,
                    cursor: 'pointer',
                    border: editing?.id === g.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius)',
                  }}
                  onClick={() => openEdit(g)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{g.name}</div>
                      {g.description && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{g.description}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="badge" style={{ fontSize: 11 }}>
                        {g._count?.users ?? 0} user(s)
                      </span>
                      <span className="badge" style={{ fontSize: 11 }}>
                        {g.privileges.length} privilege(s)
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Form panel */}
        {isFormOpen && (
          <form onSubmit={handleSubmit} style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 20,
            position: 'sticky',
            top: 80,
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{editing ? 'Edit Group' : 'New Group'}</h3>
              <button type="button" className="btn btn-sm btn-ghost" onClick={closeForm}>Close</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Group Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Description</label>
              <input
                className="form-input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <label className="form-label" style={{ margin: 0 }}>
                Privileges ({form.privileges.length}/{allPrivileges.length})
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={selectAll}>All</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={clearAll}>None</button>
              </div>
            </div>

            {Object.entries(categories).map(([key, cat]) => {
              const allChecked = cat.privileges.every((p) => form.privileges.includes(p));
              const someChecked = cat.privileges.some((p) => form.privileges.includes(p));
              return (
                <div key={key} style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'var(--text)',
                      marginBottom: 6,
                    }}
                    onClick={() => toggleCategory(cat)}
                  >
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                      onChange={() => toggleCategory(cat)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {cat.label}
                  </label>
                  <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {cat.privileges.map((p) => (
                      <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>
                        <input
                          type="checkbox"
                          checked={form.privileges.includes(p)}
                          onChange={() => togglePrivilege(p)}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" type="submit">
                {editing ? 'Update' : 'Create'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleDelete(editing)}
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

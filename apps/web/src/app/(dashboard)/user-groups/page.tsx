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
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setFormOpen(true);
  }

  function openEdit(g: GroupRecord) {
    setEditing(g);
    setForm({ name: g.name, description: g.description, privileges: [...g.privileges] });
    setFormOpen(true);
  }

  function closeForm() {
    setEditing(null);
    setForm({ name: '', description: '', privileges: [] });
    setFormOpen(false);
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
    setSaving(true);
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
    } finally {
      setSaving(false);
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

  function privilegeLabel(p: string) {
    const parts = p.split('.');
    return parts[parts.length - 1];
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          {groups.length} group{groups.length !== 1 ? 's' : ''}
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Group</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: formOpen ? '1fr 1.2fr' : '1fr', gap: 24 }}>
        {/* Groups list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.length === 0 ? (
            <div className="empty-state"><p>No user groups yet. Create one to get started.</p></div>
          ) : (
            groups.map((g) => {
              const isSelected = editing?.id === g.id;
              const userCount = g._count?.users ?? 0;
              const privCount = g.privileges.length;
              return (
                <div
                  key={g.id}
                  onClick={() => openEdit(g)}
                  style={{
                    padding: '16px 20px',
                    cursor: 'pointer',
                    border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: isSelected ? 'rgba(79, 140, 255, 0.06)' : 'var(--surface)',
                    borderRadius: 'var(--radius)',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{g.name}</div>
                      {g.description && (
                        <div style={{ color: 'var(--muted)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.description}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: userCount > 0 ? 'var(--accent)' : 'var(--muted)',
                        background: userCount > 0 ? 'rgba(79, 140, 255, 0.1)' : 'var(--bg)',
                        padding: '3px 10px',
                        borderRadius: 20,
                        whiteSpace: 'nowrap',
                      }}>
                        {userCount} user{userCount !== 1 ? 's' : ''}
                      </span>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: privCount > 0 ? 'var(--success)' : 'var(--muted)',
                        background: privCount > 0 ? 'rgba(52, 211, 153, 0.1)' : 'var(--bg)',
                        padding: '3px 10px',
                        borderRadius: 20,
                        whiteSpace: 'nowrap',
                      }}>
                        {privCount}/{allPrivileges.length}
                      </span>
                    </div>
                  </div>
                  {!formOpen && privCount > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
                      {Object.entries(categories).map(([key, cat]) => {
                        const count = cat.privileges.filter((p) => g.privileges.includes(p)).length;
                        if (count === 0) return null;
                        const full = count === cat.privileges.length;
                        return (
                          <span key={key} style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: full ? 'var(--text)' : 'var(--muted)',
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            padding: '2px 8px',
                            borderRadius: 4,
                          }}>
                            {cat.label} {!full && <span style={{ opacity: 0.6 }}>({count}/{cat.privileges.length})</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Form panel */}
        {formOpen && (
          <form onSubmit={handleSubmit} style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 24,
            position: 'sticky',
            top: 76,
            maxHeight: 'calc(100vh - 112px)',
            overflowY: 'auto',
            alignSelf: 'start',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {editing ? 'Edit Group' : 'New Group'}
              </h3>
              <button type="button" onClick={closeForm} style={{
                background: 'none',
                border: 'none',
                color: 'var(--muted)',
                fontSize: 20,
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
              }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block' }}>
                  Group Name
                </label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  style={{ width: '100%' }}
                  placeholder="e.g. Operators"
                />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block' }}>
                  Description
                </label>
                <input
                  className="form-input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Privileges
                  <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 700 }}>
                    {form.privileges.length}
                  </span>
                  <span style={{ opacity: 0.5 }}>/{allPrivileges.length}</span>
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={selectAll} style={{
                    background: 'none', border: '1px solid var(--border)', color: 'var(--muted)',
                    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                  }}>Select All</button>
                  <button type="button" onClick={clearAll} style={{
                    background: 'none', border: '1px solid var(--border)', color: 'var(--muted)',
                    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                  }}>Clear</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Object.entries(categories).map(([key, cat]) => {
                  const allChecked = cat.privileges.every((p) => form.privileges.includes(p));
                  const someChecked = cat.privileges.some((p) => form.privileges.includes(p));
                  const checkedCount = cat.privileges.filter((p) => form.privileges.includes(p)).length;
                  return (
                    <div key={key} style={{
                      background: 'var(--bg)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 14px',
                      marginBottom: 2,
                    }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          marginBottom: someChecked || allChecked ? 8 : 0,
                        }}
                        onClick={(e) => { e.preventDefault(); toggleCategory(cat); }}
                      >
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                          onChange={() => toggleCategory(cat)}
                          style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                        />
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', flex: 1 }}>
                          {cat.label}
                        </span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: allChecked ? 'var(--success)' : checkedCount > 0 ? 'var(--accent)' : 'var(--muted)',
                          opacity: allChecked ? 1 : 0.8,
                        }}>
                          {allChecked ? 'All' : `${checkedCount}/${cat.privileges.length}`}
                        </span>
                      </label>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: '2px 12px',
                        paddingLeft: 25,
                      }}>
                        {cat.privileges.map((p) => (
                          <label key={p} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            cursor: 'pointer',
                            fontSize: 12,
                            color: form.privileges.includes(p) ? 'var(--text)' : 'var(--muted)',
                            padding: '3px 0',
                            transition: 'color 0.1s',
                          }}>
                            <input
                              type="checkbox"
                              checked={form.privileges.includes(p)}
                              onChange={() => togglePrivilege(p)}
                              style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                            />
                            {privilegeLabel(p)}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: 10,
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}>
              <button className="btn btn-primary" type="submit" disabled={saving} style={{ flex: 1 }}>
                {saving ? 'Saving…' : editing ? 'Update Group' : 'Create Group'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleDelete(editing)}
                  style={{ flexShrink: 0 }}
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

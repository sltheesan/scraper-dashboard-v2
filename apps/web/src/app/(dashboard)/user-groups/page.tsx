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

  if (loading) return <div className="flex items-center justify-center py-20"><div className="spinner" /></div>;

  return (
    <div>
      {error && <div className="error-msg mb-4">{error}</div>}

      <div className="flex justify-between items-center mb-5">
        <div className="text-muted text-sm">
          {groups.length} group{groups.length !== 1 ? 's' : ''}
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Group</button>
      </div>

      <div className={`grid gap-6 ${formOpen ? 'grid-cols-1 lg:grid-cols-[1fr_1.2fr]' : 'grid-cols-1'}`}>
        {/* Groups list */}
        <div className="flex flex-col gap-2.5">
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
                  className={`px-5 py-4 cursor-pointer rounded border transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/[0.06]'
                      : 'border-border bg-surface hover:border-[var(--surface-hover)]'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px] mb-0.5">{g.name}</div>
                      {g.description && (
                        <div className="text-muted text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {g.description}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0 ml-4">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${
                        userCount > 0
                          ? 'text-accent bg-accent/10'
                          : 'text-muted bg-bg'
                      }`}>
                        {userCount} user{userCount !== 1 ? 's' : ''}
                      </span>
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${
                        privCount > 0
                          ? 'text-success bg-success/10'
                          : 'text-muted bg-bg'
                      }`}>
                        {privCount}/{allPrivileges.length}
                      </span>
                    </div>
                  </div>
                  {!formOpen && privCount > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {Object.entries(categories).map(([key, cat]) => {
                        const count = cat.privileges.filter((p) => g.privileges.includes(p)).length;
                        if (count === 0) return null;
                        const full = count === cat.privileges.length;
                        return (
                          <span key={key} className={`text-[11px] font-medium bg-bg border border-border px-2 py-0.5 rounded ${full ? 'text-[var(--text)]' : 'text-muted'}`}>
                            {cat.label} {!full && <span className="opacity-60">({count}/{cat.privileges.length})</span>}
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
          <form
            onSubmit={handleSubmit}
            className="bg-surface border border-border rounded p-6 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-112px)] lg:overflow-y-auto lg:self-start"
          >
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-[17px] font-bold">
                {editing ? 'Edit Group' : 'New Group'}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                className="bg-transparent border-none text-muted text-xl cursor-pointer px-1 leading-none hover:text-[var(--text)]"
              >
                x
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              <div>
                <label className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5 block">
                  Group Name
                </label>
                <input
                  className="form-input w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="e.g. Operators"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5 block">
                  Description
                </label>
                <input
                  className="form-input w-full"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex justify-between items-center mb-3.5">
                <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">
                  Privileges
                  <span className="ml-2 text-accent font-bold">
                    {form.privileges.length}
                  </span>
                  <span className="opacity-50">/{allPrivileges.length}</span>
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="bg-transparent border border-border text-muted text-[11px] font-semibold px-2.5 py-0.5 rounded cursor-pointer hover:bg-surface-hover transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="bg-transparent border border-border text-muted text-[11px] font-semibold px-2.5 py-0.5 rounded cursor-pointer hover:bg-surface-hover transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="border border-border rounded-sm overflow-hidden">
                {Object.entries(categories).map(([key, cat], idx) => {
                  const allChecked = cat.privileges.every((p) => form.privileges.includes(p));
                  const someChecked = cat.privileges.some((p) => form.privileges.includes(p));
                  return (
                    <div
                      key={key}
                      className={`flex items-center bg-bg ${idx < Object.keys(categories).length - 1 ? 'border-b border-border' : ''}`}
                    >
                      <label
                        className={`flex items-center gap-2 cursor-pointer py-2 px-3 w-[130px] shrink-0 border-r border-border ${allChecked ? 'bg-accent/[0.06]' : 'bg-transparent'}`}
                        onClick={(e) => { e.preventDefault(); toggleCategory(cat); }}
                      >
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                          onChange={() => toggleCategory(cat)}
                          className="accent-accent w-3.5 h-3.5 shrink-0"
                        />
                        <span className="font-semibold text-xs text-[var(--text)] whitespace-nowrap">
                          {cat.label}
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-x-1 gap-y-0 px-2.5 py-1 flex-1">
                        {cat.privileges.map((p) => (
                          <label
                            key={p}
                            className={`flex items-center gap-[5px] cursor-pointer text-xs px-1.5 py-1 rounded-sm transition-colors ${
                              form.privileges.includes(p) ? 'text-[var(--text)]' : 'text-muted'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={form.privileges.includes(p)}
                              onChange={() => togglePrivilege(p)}
                              className="accent-accent w-[13px] h-[13px]"
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

            <div className="flex gap-2.5 mt-5 pt-4 border-t border-border">
              <button className="btn btn-primary flex-1" type="submit" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Update Group' : 'Create Group'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-danger shrink-0"
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

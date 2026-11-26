'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface GroupRecord {
  id: string;
  name: string;
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  groupId: string | null;
  group: GroupRecord | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
}

export default function UsersPage() {
  const { user, hasPrivilege } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', groupId: '' });

  useEffect(() => {
    if (!hasPrivilege('users.view')) {
      router.replace('/');
      return;
    }
    loadData();
  }, [user, router, hasPrivilege]);

  async function loadData() {
    try {
      const [u, g] = await Promise.all([
        api.get<UserRecord[]>('/users'),
        hasPrivilege('groups.manage')
          ? api.get<GroupRecord[]>('/user-groups').catch(() => [])
          : Promise.resolve([]),
      ]);
      setUsers(u);
      setGroups(g);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeGroup(userId: string, groupId: string) {
    setError('');
    try {
      await api.patch(`/users/${userId}/group`, { groupId: groupId || null });
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleActive(u: UserRecord) {
    setError('');
    try {
      const endpoint = u.isActive ? 'deactivate' : 'activate';
      await api.patch(`/users/${u.id}/${endpoint}`, {});
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteUser(u: UserRecord) {
    if (!confirm(`Delete user "${u.name}" (${u.email})?`)) return;
    setError('');
    try {
      await api.delete(`/users/${u.id}`);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', {
        email: form.email,
        password: form.password,
        name: form.name,
        groupId: form.groupId || undefined,
      });
      setForm({ email: '', password: '', name: '', groupId: '' });
      setShowCreate(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="spinner" /></div>;

  return (
    <div>
      {error && <div className="error-msg mb-4">{error}</div>}

      <div className="flex justify-between items-center mb-4">
        <div className="text-muted text-sm">{users.length} user(s)</div>
        {hasPrivilege('users.create') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancel' : '+ New User'}
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card mb-5 p-5">
          <h3 className="mb-4 text-base font-semibold">Create User</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </div>
            <div>
              <label className="form-label">User Group</label>
              <select className="form-input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                <option value="">— No Group —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <button className="btn btn-primary" type="submit">Create</button>
          </div>
        </form>
      )}

      {users.length === 0 ? (
        <div className="empty-state"><p>No users found.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden sm:table-cell">Email</th>
                <th className="hidden md:table-cell">Group</th>
                <th>Status</th>
                <th className="hidden lg:table-cell">Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                const isSuper = u.isSuperAdmin;
                return (
                  <tr key={u.id}>
                    <td className="cell-name">
                      {u.name}
                      {isSuper && <span className="badge badge-active ml-2 text-[10px]">Super Admin</span>}
                    </td>
                    <td className="hidden sm:table-cell">{u.email}</td>
                    <td className="hidden md:table-cell">
                      {isSuper ? (
                        <span className="text-muted italic">All privileges</span>
                      ) : (
                        <select
                          className="role-select"
                          value={u.groupId || ''}
                          onChange={(e) => changeGroup(u.id, e.target.value)}
                          disabled={isSelf || !hasPrivilege('users.edit')}
                        >
                          <option value="">— No Group —</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-active' : 'badge-inactive'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="cell-muted hidden lg:table-cell">{formatDate(u.lastLoginAt)}</td>
                    <td className="cell-actions">
                      {!isSelf && !isSuper && hasPrivilege('users.edit') && (
                        <button
                          className={`btn btn-sm ${u.isActive ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                      {!isSelf && !isSuper && hasPrivilege('users.delete') && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteUser(u)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

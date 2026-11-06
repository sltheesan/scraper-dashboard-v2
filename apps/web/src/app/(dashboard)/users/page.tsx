'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
}

export default function UsersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    loadUsers();
  }, [user, router]);

  async function loadUsers() {
    try {
      const data = await api.get<UserRecord[]>('/users');
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    setError('');
    try {
      await api.patch(`/users/${userId}/role`, { role });
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleActive(u: UserRecord) {
    setError('');
    try {
      const endpoint = u.isActive ? 'deactivate' : 'activate';
      await api.patch(`/users/${u.id}/${endpoint}`, {});
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteUser(u: UserRecord) {
    if (!confirm(`Delete user "${u.name}" (${u.email})?`)) return;
    setError('');
    try {
      await api.delete(`/users/${u.id}`);
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      {users.length === 0 ? (
        <div className="empty-state"><p>No users found.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="cell-name">{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className="role-select"
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      disabled={u.id === user?.id}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="OPERATOR">OPERATOR</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.isActive ? 'badge-active' : 'badge-inactive'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="cell-muted">{formatDate(u.lastLoginAt)}</td>
                  <td className="cell-actions">
                    {u.id !== user?.id && (
                      <>
                        <button
                          className={`btn btn-sm ${u.isActive ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteUser(u)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

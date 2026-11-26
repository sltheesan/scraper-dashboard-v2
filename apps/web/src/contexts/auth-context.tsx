'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { api, ApiError } from '@/lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  groupId: string | null;
  groupName: string | null;
  privileges: string[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPrivilege: (privilege: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let token: string | null = null;
    try { token = localStorage.getItem('token'); } catch {}
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<User>('/auth/me')
      .then(setUser)
      .catch(() => { try { localStorage.removeItem('token'); } catch {} })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: User }>(
      '/auth/login',
      { email, password },
    );
    try { localStorage.setItem('token', res.accessToken); } catch {}
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout', {}).catch(() => {});
    try { localStorage.removeItem('token'); } catch {}
    setUser(null);
  }, []);

  const hasPrivilege = useCallback(
    (privilege: string) => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return user.privileges.includes(privilege);
    },
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPrivilege }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

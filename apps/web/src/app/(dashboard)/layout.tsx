'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '▦' },
  { href: '/profiles', label: 'Profiles', icon: '◉', privilege: 'profiles.view' },
  { href: '/logs', label: 'Live Logs', icon: '▤', privilege: 'logs.view' },
  { href: '/activity', label: 'Activity', icon: '◷', privilege: 'activity.view' },
  { href: '/users', label: 'Users', icon: '♟', privilege: 'users.view' },
  { href: '/user-groups', label: 'User Groups', icon: '⚑', privilege: 'groups.manage' },
  { href: '/settings', label: 'Settings', icon: '⚙', privilege: 'settings.view' },
];

function formatBangkokTime() {
  const now = new Date();
  return now.toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout, hasPrivilege } = useAuth();
  const [clock, setClock] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    setClock(formatBangkokTime());
    const id = setInterval(() => setClock(formatBangkokTime()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }, [theme]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return null;

  const roleLabel = user.isSuperAdmin ? 'Super Admin' : (user.groupName || 'No Group');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">◈</span>
          <span>Scraper v2</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter(
            (item) => !item.privilege || hasPrivilege(item.privilege),
          ).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)) ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">Scraper Dashboard v2</div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <h2 className="page-title">
            {NAV_ITEMS.find((i) => i.href === pathname)?.label ||
             NAV_ITEMS.find((i) => i.href !== '/' && pathname.startsWith(i.href))?.label ||
             'Dashboard'}
          </h2>
          <div className="top-bar-right">
            <div className="header-clock">
              <span>{clock}</span>
              <span className="clock-tz">ICT</span>
            </div>
            <span className="env-badge">v2</span>
            <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <div className="header-user">
              <span className="header-user-name">{user.name}</span>
              <span className="header-user-role">{roleLabel}</span>
            </div>
            <button className="header-logout" onClick={logout}>Sign out</button>
          </div>
        </header>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '▦' },
  { href: '/profiles', label: 'Profiles', icon: '◉' },
  { href: '/logs', label: 'Live Logs', icon: '▤' },
  { href: '/activity', label: 'Activity', icon: '◷' },
  { href: '/users', label: 'Users', icon: '♟', adminOnly: true },
  { href: '/settings', label: 'Settings', icon: '⚙', adminOnly: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">◈</span>
          <span>Scraper v2</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter(
            (item) => !item.adminOnly || user.role === 'ADMIN',
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

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.role}</div>
          </div>
          <button className="logout-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <h2 className="page-title">
            {NAV_ITEMS.find((i) => i.href === pathname)?.label ||
             NAV_ITEMS.find((i) => i.href !== '/' && pathname.startsWith(i.href))?.label ||
             'Dashboard'}
          </h2>
          <div className="top-bar-right">
            <span className="env-badge">v2</span>
          </div>
        </header>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}

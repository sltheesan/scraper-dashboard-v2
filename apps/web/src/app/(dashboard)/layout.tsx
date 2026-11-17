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
  { href: '/reports', label: 'Reports', icon: '◩', privilege: 'reports.view' },
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return null;

  const roleLabel = user.isSuperAdmin ? 'Super Admin' : (user.groupName || 'No Group');

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 bottom-0 z-30 w-60 bg-surface border-r border-border
        flex flex-col transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        <div className="px-5 py-4 font-bold text-base flex items-center gap-2.5 border-b border-border">
          <span className="text-xl text-accent">◈</span>
          <span>Scraper v2</span>
        </div>

        <nav className="flex-1 p-3 flex flex-col gap-0.5 overflow-y-auto">
          {NAV_ITEMS.filter(
            (item) => !item.privilege || hasPrivilege(item.privilege),
          ).map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-2.5 px-3.5 py-2.5 rounded-sm text-sm font-medium no-underline
                  transition-colors duration-150
                  ${isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:bg-surface-hover hover:text-[var(--text)]'
                  }
                `}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-border text-xs text-muted text-center">
          Scraper Dashboard v2
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-60 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-13 px-4 md:px-6 flex items-center justify-between border-b border-border bg-surface sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              className="md:hidden p-1.5 -ml-1 rounded-sm text-muted hover:bg-surface-hover hover:text-[var(--text)] transition-colors"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 5h14M3 10h14M3 15h14" />
              </svg>
            </button>

            <h2 className="text-base font-semibold truncate">
              {NAV_ITEMS.find((i) => i.href === pathname)?.label ||
               NAV_ITEMS.find((i) => i.href !== '/' && pathname.startsWith(i.href))?.label ||
               'Dashboard'}
            </h2>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-muted tabular-nums">
              <span>{clock}</span>
              <span className="text-[10px] uppercase tracking-wide opacity-70">ICT</span>
            </div>

            <span className="hidden sm:inline-block text-[11px] font-bold uppercase tracking-wide bg-accent/15 text-accent px-2 py-0.5 rounded">
              v2
            </span>

            <button
              className="w-8 h-8 grid place-items-center rounded-sm border border-border text-muted hover:bg-surface-hover hover:text-[var(--text)] transition-colors text-base leading-none"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>

            <div className="hidden sm:flex items-center gap-2.5 text-xs">
              <span className="font-semibold text-[var(--text)]">{user.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted bg-bg px-1.5 py-0.5 rounded">
                {roleLabel}
              </span>
            </div>

            <button
              className="text-xs text-muted border border-border rounded-sm px-2.5 py-1 hover:bg-surface-hover hover:text-[var(--text)] transition-colors"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-7">{children}</div>
      </main>
    </div>
  );
}

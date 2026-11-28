'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  profiles: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>,
  logs: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  activity: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  groups: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  reports: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', iconKey: 'dashboard' },
  { href: '/profiles', label: 'Profiles', iconKey: 'profiles', privilege: 'profiles.view' },
  { href: '/logs', label: 'Live Logs', iconKey: 'logs', privilege: 'logs.view' },
  { href: '/activity', label: 'Activity', iconKey: 'activity', privilege: 'activity.view' },
  { href: '/users', label: 'Users', iconKey: 'users', privilege: 'users.view' },
  { href: '/user-groups', label: 'User Groups', iconKey: 'groups', privilege: 'groups.manage' },
  { href: '/reports', label: 'Reports', iconKey: 'reports', privilege: 'reports.view' },
  { href: '/settings', label: 'Settings', iconKey: 'settings', privilege: 'settings.view' },
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
  const [vncSession, setVncSession] = useState<{ active: boolean; userName?: string; profileName?: string; isOwner?: boolean } | null>(null);
  const [vncEnding, setVncEnding] = useState(false);

  useEffect(() => {
    setClock(formatBangkokTime());
    const id = setInterval(() => setClock(formatBangkokTime()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
      if (saved) {
        setTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch {}
  }, [theme]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    function pollVnc() {
      api.get<{ active: boolean; userName?: string; profileName?: string; isOwner?: boolean }>('/vnc/session')
        .then(setVncSession)
        .catch(() => {});
    }
    pollVnc();
    const id = setInterval(pollVnc, 10_000);
    return () => clearInterval(id);
  }, [user]);

  async function endVncSession() {
    setVncEnding(true);
    try {
      await api.post('/vnc/end-session', {});
      setVncSession({ active: false });
    } catch {}
    setVncEnding(false);
  }

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
                <span className="w-5 text-center flex items-center justify-center">{NAV_ICONS[item.iconKey]}</span>
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

        {vncSession?.active && (
          <div className="mx-4 md:mx-7 mt-3 flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-sm px-4 py-2.5 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning shrink-0">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
            <span className="flex-1 min-w-0">
              <strong>{vncSession.userName}</strong> is using VNC
              {vncSession.profileName && <> for <strong>{vncSession.profileName}</strong></>}
            </span>
            <button
              className="btn btn-sm btn-danger shrink-0"
              disabled={vncEnding}
              onClick={endVncSession}
            >
              {vncEnding ? 'Ending...' : 'End VNC Session'}
            </button>
          </div>
        )}
        <div className="flex-1 p-4 md:p-7">{children}</div>
      </main>
    </div>
  );
}

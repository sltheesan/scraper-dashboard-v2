'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-4 bg-bg">
      <div className="w-full max-w-sm flex flex-col items-center">
        <form
          className="bg-surface border border-border rounded-lg p-8 sm:p-10 w-full flex flex-col gap-5 shadow-lg shadow-black/20"
          onSubmit={handleSubmit}
        >
          <div className="text-center">
            <span className="text-3xl text-accent block mb-2">◈</span>
            <h1 className="text-xl font-bold tracking-tight">Scraper Dashboard</h1>
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent/70 mt-1 block">v2</span>
          </div>
          <p className="text-center text-muted text-sm -mt-2">Sign in to your account</p>

          {error && (
            <div className="bg-error/10 border border-error/30 text-error px-3.5 py-2.5 rounded-sm text-sm">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1.5 text-sm text-muted">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
              className="bg-bg border border-border rounded-sm px-3 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-accent transition-colors placeholder:text-muted/50"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-muted">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              className="bg-bg border border-border rounded-sm px-3 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-accent transition-colors placeholder:text-muted/50"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-white rounded-sm px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-muted/40 text-[11px] mt-6 text-center">
          Scraper Dashboard v2 · 200M Financial Systems
        </p>
      </div>
    </main>
  );
}

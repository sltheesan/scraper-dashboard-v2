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
      <form
        className="bg-surface border border-border rounded-lg p-8 sm:p-10 w-full max-w-sm flex flex-col gap-5"
        onSubmit={handleSubmit}
      >
        <h1 className="text-[22px] font-semibold text-center">Scraper Dashboard</h1>
        <p className="text-center text-muted text-sm -mt-3">Sign in to continue</p>

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
            placeholder="admin@200m.co"
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
          className="bg-accent text-white rounded-sm px-4 py-2.5 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

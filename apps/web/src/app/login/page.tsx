'use client';

import { APP_NAME, APP_TAGLINE } from '@zerodue/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, NetworkError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const { status, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' || status === 'offline') router.replace('/');
  }, [status, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const name = String(form.get('name') ?? '').trim();

    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name);
      router.replace('/');
    } catch (e) {
      if (e instanceof NetworkError) setError('Cannot reach the server. Check your connection.');
      else if (e instanceof ApiError && e.status === 429)
        setError('Too many attempts. Wait a minute and try again.');
      else if (e instanceof ApiError) setError(e.message);
      else setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'min-h-12 w-full rounded-xl border border-slate-300 bg-transparent px-4 text-base dark:border-slate-700';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">{APP_TAGLINE}</p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <h2 className="text-lg font-medium">
          {mode === 'login' ? 'Sign in' : 'Create your account'}
        </h2>

        {mode === 'register' && (
          <label className="flex flex-col gap-1 text-sm">
            Name (optional)
            <input name="name" type="text" autoComplete="name" className={input} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 10 : undefined}
            className={input}
          />
          {mode === 'register' && (
            <span className="text-xs text-slate-500">At least 10 characters.</span>
          )}
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded-xl bg-teal-700 px-4 font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
        className="min-h-12 text-sm text-teal-700 underline dark:text-teal-400"
      >
        {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </main>
  );
}

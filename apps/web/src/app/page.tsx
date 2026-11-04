'use client';

import { APP_NAME, APP_TAGLINE, formatDate, formatINR } from '@zerodue/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { status, user, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'loading' || status === 'unauthenticated' || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500" role="status">
          Loading…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{APP_TAGLINE}</p>
        </div>
        {status === 'offline' && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
            Offline
          </span>
        )}
      </header>

      <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-400">Signed in as</p>
        <p className="text-lg font-medium">{user.name ?? user.email}</p>
        {user.name && <p className="text-sm text-slate-500">{user.email}</p>}
      </section>

      <section className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm dark:border-slate-700">
        <p className="font-medium">Foundations ready (M1)</p>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          Indian formatting check: {formatINR(12_930_000)} · {formatINR(60_000_000)} ·{' '}
          {formatDate(new Date())}
        </p>
      </section>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-auto min-h-12 rounded-xl border border-slate-300 px-4 font-medium dark:border-slate-700"
      >
        Sign out
      </button>
    </main>
  );
}

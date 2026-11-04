'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { startSyncing } from '@/lib/sync';

/** Everything behind sign-in: redirects visitors, and keeps this device in sync while the app is open. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const signedIn = status === 'authenticated' || status === 'offline';

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  useEffect(() => (signedIn ? startSyncing() : undefined), [signedIn]);

  if (!signedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500" role="status">
          Loading…
        </p>
      </main>
    );
  }
  return <AppShell>{children}</AppShell>;
}

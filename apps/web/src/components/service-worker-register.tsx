'use client';

import { useEffect } from 'react';

/** Registers the service worker in production builds only; in dev it would cache stale bundles. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // the worker needs the API address to act on notification buttons; it can't read the page's env
    const api = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    navigator.serviceWorker
      .register(`/sw.js?api=${encodeURIComponent(api)}`, { scope: '/' })
      .catch(() => {
        /* registration can fail in private windows; the app works without it */
      });
  }, []);
  return null;
}

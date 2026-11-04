'use client';

import { useEffect } from 'react';

/** Registers the service worker in production builds only; in dev it would cache stale bundles. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* registration can fail in private windows; the app works without it */
    });
  }, []);
  return null;
}

/* ZeroDue service worker (M1 shell).
 * - Precaches the offline fallback.
 * - Static build assets (/_next/static, icons): cache-first (filenames are content-hashed).
 * - Page navigations: network-first, falling back to the last cached copy, then /offline.html.
 * - API calls are never cached here; offline data lives in IndexedDB (see src/lib/db.ts).
 * - Push: shows bill reminders; the Mark paid / Remind me later buttons call the API directly.
 *   The API address arrives as ?api=... on the registration URL (a worker can't read the page's env). */
const VERSION = 'v1';
const SHELL_CACHE = `zerodue-shell-${VERSION}`;
const STATIC_CACHE = `zerodue-static-${VERSION}`;
const PAGES_CACHE = `zerodue-pages-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon.svg', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE, PAGES_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API is a different origin: never intercept

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('/')) ||
      (await caches.match(OFFLINE_URL)) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}

// ───────────────────────── push notifications ─────────────────────────

const API = new URL(self.location.href).searchParams.get('api') || '';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* a malformed push still shows something */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ZeroDue', {
      body: data.body || '',
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: data.reminderId || 'zerodue',
      data: { url: data.url || '/bills', reminderId: data.reminderId },
      actions: (data.actions || []).slice(0, 2),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, reminderId } = event.notification.data || {};
  if ((event.action === 'paid' || event.action === 'snooze') && reminderId && API) {
    event.waitUntil(act(event.action, reminderId).catch(() => openApp(url)));
  } else {
    event.waitUntil(openApp(url));
  }
});

/** The page keeps its access token in memory, so the worker signs itself in with the refresh cookie. */
async function accessToken() {
  const res = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error('signed out');
  return (await res.json()).accessToken;
}

async function act(action, reminderId) {
  const token = await accessToken();
  const paid = action === 'paid';
  const res = await fetch(`${API}/reminders/${reminderId}/${paid ? 'mark-paid' : 'snooze'}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    credentials: 'include',
    body: paid ? '{}' : JSON.stringify({ minutes: 180 }),
  });
  if (!res.ok) throw new Error('request failed');
  await self.registration.showNotification(
    paid ? 'Marked as paid' : 'Reminder snoozed for 3 hours',
    {
      tag: 'zerodue-result',
      icon: '/icons/icon.svg',
      silent: true,
    },
  );
  // clear the confirmation after a few seconds
  await new Promise((resolve) => setTimeout(resolve, 4000));
  for (const n of await self.registration.getNotifications({ tag: 'zerodue-result' })) n.close();
}

async function openApp(url) {
  const target = url || '/';
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if ('focus' in client) {
      await client.navigate?.(target).catch(() => undefined);
      return client.focus();
    }
  }
  return self.clients.openWindow(target);
}

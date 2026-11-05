import { readMeta, writeMeta } from './db';
import { request } from './api';

/** Whether this browser can receive push notifications at all (iPhones need the app added to the home screen). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

const SUBSCRIPTION_KEY = 'pushSubscriptionId';

/** The browser's public key format (URL-safe base64) as the bytes `subscribe` wants. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** What the API needs to remember a subscription. */
export function subscriptionBody(subscription: { toJSON(): unknown }): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('This browser gave an incomplete push subscription.');
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Asks permission, subscribes this browser and tells the server. Throws a readable message on failure. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot receive notifications.');
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    throw new Error(
      'Notifications work in the installed app. Open the deployed app, not the dev server.',
    );
  }
  const { publicKey } = await request<{ publicKey: string | null }>('/push/vapid-public-key', {
    anonymous: true,
  });
  if (!publicKey)
    throw new Error('Notifications are not set up on the server yet (no VAPID keys).');

  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error('Notifications are blocked for this site. Allow them in the browser settings.');
  }
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  const saved = await request<{ id: string }>('/push/subscriptions', {
    method: 'POST',
    body: subscriptionBody(subscription),
  });
  await writeMeta(SUBSCRIPTION_KEY, saved.id);
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  const id = await readMeta<string>(SUBSCRIPTION_KEY);
  if (id)
    await request<void>(`/push/subscriptions/${id}`, { method: 'DELETE' }).catch(() => undefined);
  await subscription?.unsubscribe();
  await writeMeta(SUBSCRIPTION_KEY, undefined);
}

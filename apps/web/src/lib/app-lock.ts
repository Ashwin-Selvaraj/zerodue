import { readMeta, writeMeta } from './db';

/**
 * A PIN that hides the app after a while or when it comes back from the background.
 * It keeps casual eyes out. It does not encrypt the data stored on the device.
 */

const KEY = 'appLock';
export const PIN_PATTERN = /^\d{4,12}$/;
const PIN_ITERATIONS = 150_000;

export interface LockSettings {
  salt: string;
  hash: string;
  iterations: number;
  /** Seconds away from the app (or without touching it) before it locks. 0 locks as soon as you leave. */
  timeoutSec: number;
  failures: number;
  /** Epoch ms before which no attempt is accepted. */
  lockedUntil: number;
}

export const TIMEOUT_CHOICES: [number, string][] = [
  [0, 'As soon as I leave the app'],
  [60, 'After 1 minute'],
  [300, 'After 5 minutes'],
  [900, 'After 15 minutes'],
];

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function hashPin(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Compares without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** After five wrong tries each further one costs a longer wait, up to an hour. */
export function waitAfterFailures(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(30_000 * 2 ** (failures - 5), 3_600_000);
}

/** True when the app has been away or untouched for long enough to lock. */
export function isIdleTooLong(now: number, lastActive: number, timeoutSec: number): boolean {
  return now - lastActive >= timeoutSec * 1000;
}

export async function readLock(): Promise<LockSettings | null> {
  return (await readMeta<LockSettings>(KEY)) ?? null;
}

export async function setPin(pin: string, timeoutSec: number): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw new Error('Use 4 to 12 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await writeMeta(KEY, {
    salt: toBase64(salt),
    hash: await hashPin(pin, salt, PIN_ITERATIONS),
    iterations: PIN_ITERATIONS,
    timeoutSec,
    failures: 0,
    lockedUntil: 0,
  } satisfies LockSettings);
}

export async function setLockTimeout(timeoutSec: number): Promise<void> {
  const current = await readLock();
  if (current) await writeMeta(KEY, { ...current, timeoutSec });
}

export async function removeLock(): Promise<void> {
  await writeMeta(KEY, null);
}

export type UnlockResult =
  { ok: true } | { ok: false; waitMs: number; reason: 'wrong' | 'waiting' | 'none' };

/** Checks a PIN, counting misses and making repeated ones wait. */
export async function tryPin(pin: string, now = Date.now()): Promise<UnlockResult> {
  const lock = await readLock();
  if (!lock) return { ok: false, waitMs: 0, reason: 'none' };
  if (now < lock.lockedUntil)
    return { ok: false, waitMs: lock.lockedUntil - now, reason: 'waiting' };
  const attempt = await hashPin(pin, fromBase64(lock.salt), lock.iterations);
  if (sameText(attempt, lock.hash)) {
    await writeMeta(KEY, { ...lock, failures: 0, lockedUntil: 0 });
    return { ok: true };
  }
  const failures = lock.failures + 1;
  const waitMs = waitAfterFailures(failures);
  await writeMeta(KEY, { ...lock, failures, lockedUntil: waitMs ? now + waitMs : 0 });
  return { ok: false, waitMs, reason: 'wrong' };
}

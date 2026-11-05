'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getDb } from '@/lib/db';
import { isIdleTooLong, readLock, tryPin } from '@/lib/app-lock';
import { ui } from './ui';

export const LOCK_CHANGED = 'zerodue:lock-changed';
export const LOCK_NOW = 'zerodue:lock-now';

/**
 * Covers the app with a PIN screen when the app lock is on: when the app opens, after it has been
 * away or untouched for the chosen time, or on "Lock now". The app stays mounted underneath
 * (hidden), so a form half filled in is still there after unlocking.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const [timeoutSec, setTimeoutSec] = useState<number | null | undefined>(undefined);
  const [locked, setLocked] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const lastActive = useRef(Date.now());
  const firstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const lock = await readLock();
      if (cancelled) return;
      setTimeoutSec(lock ? lock.timeoutSec : null);
      // the first read decides whether to start locked; a later change (setting or removing a PIN) never locks
      if (firstLoad.current) setLocked(Boolean(lock));
      else if (!lock) setLocked(false);
      firstLoad.current = false;
    };
    void load();
    const onChanged = () => void load();
    window.addEventListener(LOCK_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(LOCK_CHANGED, onChanged);
    };
  }, []);

  useEffect(() => {
    if (timeoutSec === null || timeoutSec === undefined) return;
    let hiddenAt: number | null = null;
    const touch = () => {
      lastActive.current = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        if (timeoutSec === 0) setLocked(true);
      } else if (hiddenAt !== null) {
        if (isIdleTooLong(Date.now(), hiddenAt, timeoutSec)) setLocked(true);
        hiddenAt = null;
        touch();
      }
    };
    const idle = setInterval(() => {
      if (timeoutSec > 0 && isIdleTooLong(Date.now(), lastActive.current, timeoutSec)) {
        setLocked(true);
      }
    }, 5000);
    const lockNow = () => setLocked(true);
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(LOCK_NOW, lockNow);
    return () => {
      clearInterval(idle);
      events.forEach((name) => window.removeEventListener(name, touch));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(LOCK_NOW, lockNow);
    };
  }, [timeoutSec]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setChecking(true);
    const result = await tryPin(String(new FormData(form).get('pin') ?? ''));
    setChecking(false);
    form.reset();
    if (result.ok) {
      lastActive.current = Date.now();
      setMessage(null);
      setLocked(false);
    } else if (result.reason === 'none') {
      setLocked(false);
    } else if (result.waitMs > 0) {
      setMessage(`Too many tries. Wait ${Math.ceil(result.waitMs / 1000)} seconds.`);
    } else {
      setMessage('That is not your PIN.');
    }
  }

  async function forgot() {
    const waiting = await getDb().outbox.count();
    const note = waiting
      ? ` ${waiting} change${waiting === 1 ? ' has' : 's have'} not been sent yet and will be lost.`
      : '';
    if (
      window.confirm(
        `Sign out to reset the lock? This removes the copy stored on this device.${note}`,
      )
    ) {
      await logout();
    }
  }

  const showLock = locked && timeoutSec !== null;
  return (
    <>
      <div hidden={showLock || timeoutSec === undefined}>{children}</div>
      {showLock && timeoutSec !== undefined && (
        <main className="flex min-h-screen items-center justify-center px-4">
          <form onSubmit={unlock} className="flex w-full max-w-xs flex-col gap-3 text-center">
            <h1 className={ui.title}>ZeroDue is locked</h1>
            <label className={ui.label + ' text-left'}>
              PIN
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                className={ui.input}
              />
            </label>
            <button type="submit" className={ui.primary} disabled={checking}>
              Unlock
            </button>
            {message && (
              <p role="alert" className={ui.error}>
                {message}
              </p>
            )}
            <button type="button" className={ui.link + ' min-h-12'} onClick={() => void forgot()}>
              Forgot PIN? Sign out
            </button>
          </form>
        </main>
      )}
    </>
  );
}

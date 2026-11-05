'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  PIN_PATTERN,
  TIMEOUT_CHOICES,
  readLock,
  removeLock,
  setLockTimeout,
  setPin,
  tryPin,
  type LockSettings,
} from '@/lib/app-lock';
import { LOCK_CHANGED, LOCK_NOW } from './lock-gate';
import { ui } from './ui';

/** Turn the app lock on and off, change the PIN, and lock right now. */
export function LockCard() {
  const [lock, setLock] = useState<LockSettings | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'pin' | 'off' | null>(null);

  const load = useCallback(async () => setLock(await readLock()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    window.dispatchEvent(new Event(LOCK_CHANGED));
  };

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pin = String(form.get('pin') ?? '');
    if (!PIN_PATTERN.test(pin)) return setError('Use 4 to 12 digits.');
    if (pin !== String(form.get('again') ?? '')) return setError('The two PINs are different.');
    await setPin(pin, Number(form.get('timeout') ?? 60));
    setError(null);
    setEditing(null);
    await changed();
  }

  async function confirmCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await tryPin(String(form.get('current') ?? ''));
    if (!result.ok) {
      setError(
        result.reason === 'waiting'
          ? `Too many tries. Wait ${Math.ceil(result.waitMs / 1000)} seconds.`
          : 'That is not your PIN.',
      );
      return;
    }
    if (editing === 'off') {
      await removeLock();
    } else {
      const pin = String(form.get('pin') ?? '');
      if (!PIN_PATTERN.test(pin)) return setError('Use 4 to 12 digits.');
      if (pin !== String(form.get('again') ?? '')) return setError('The two PINs are different.');
      await setPin(pin, lock?.timeoutSec ?? 60);
    }
    setError(null);
    setEditing(null);
    await changed();
  }

  if (lock === undefined) return null;

  return (
    <section aria-label="App lock" className={ui.card}>
      <h2 className="mb-1 font-medium">App lock</h2>
      <p className={ui.muted + ' mb-3'}>
        Asks for a PIN when you come back to the app, so it stays private if someone picks up your
        phone. It does not encrypt what is stored on the device.
      </p>

      {!lock && (
        <form onSubmit={enable} className="flex flex-col gap-3" noValidate>
          <label className={ui.label}>
            New PIN (4 to 12 digits)
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className={ui.input}
            />
          </label>
          <label className={ui.label}>
            Type it again
            <input
              name="again"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className={ui.input}
            />
          </label>
          <label className={ui.label}>
            Lock
            <select name="timeout" defaultValue="60" className={ui.input}>
              {TIMEOUT_CHOICES.map(([seconds, label]) => (
                <option key={seconds} value={seconds}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={ui.primary}>
            Turn on app lock
          </button>
        </form>
      )}

      {lock && !editing && (
        <div className="flex flex-col gap-3">
          <label className={ui.label}>
            Lock
            <select
              value={lock.timeoutSec}
              className={ui.input}
              onChange={async (e) => {
                await setLockTimeout(Number(e.target.value));
                await changed();
              }}
            >
              {TIMEOUT_CHOICES.map(([seconds, label]) => (
                <option key={seconds} value={seconds}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => window.dispatchEvent(new Event(LOCK_NOW))}
          >
            Lock now
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={ui.secondary} onClick={() => setEditing('pin')}>
              Change PIN
            </button>
            <button type="button" className={ui.danger} onClick={() => setEditing('off')}>
              Turn off
            </button>
          </div>
        </div>
      )}

      {lock && editing && (
        <form onSubmit={confirmCurrent} className="flex flex-col gap-3" noValidate>
          <label className={ui.label}>
            Current PIN
            <input
              name="current"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className={ui.input}
            />
          </label>
          {editing === 'pin' && (
            <>
              <label className={ui.label}>
                New PIN
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  className={ui.input}
                />
              </label>
              <label className={ui.label}>
                Type it again
                <input
                  name="again"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  className={ui.input}
                />
              </label>
            </>
          )}
          <button type="submit" className={editing === 'off' ? ui.danger : ui.primary}>
            {editing === 'off' ? 'Turn off app lock' : 'Change PIN'}
          </button>
          <button
            type="button"
            className={ui.link}
            onClick={() => {
              setEditing(null);
              setError(null);
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className={ui.error + ' mt-3'}>
          {error}
        </p>
      )}
    </section>
  );
}

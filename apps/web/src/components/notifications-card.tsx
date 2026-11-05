'use client';

import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push';
import { ui } from './ui';

const TEXT: Record<PushState, string> = {
  unsupported:
    'This browser can’t show notifications. On an iPhone, add ZeroDue to your home screen first.',
  blocked:
    'Notifications are blocked for this site. Allow them in your browser settings to turn this on.',
  off: 'Get a reminder before each bill is due, even when the app is closed.',
  on: 'On. You’ll get reminders on this device before bills are due.',
};

/** Turn bill reminders on or off for this device. */
export function NotificationsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (state === 'on') await disablePush();
      else await enablePush();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change notifications.');
    } finally {
      setState(await getPushState());
      setBusy(false);
    }
  }

  return (
    <section aria-label="Notifications" className={ui.card + ' flex flex-col gap-2'}>
      <h2 className="font-medium">Notifications</h2>
      <p className={ui.muted}>{state ? TEXT[state] : 'Checking…'}</p>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      {(state === 'off' || state === 'on') && (
        <button
          className={state === 'on' ? ui.secondary : ui.primary}
          disabled={busy}
          onClick={toggle}
        >
          {state === 'on' ? 'Turn off' : 'Turn on notifications'}
        </button>
      )}
    </section>
  );
}

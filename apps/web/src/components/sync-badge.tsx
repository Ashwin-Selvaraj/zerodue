'use client';

import { formatDateTime } from '@zerodue/shared';
import { useOutboxCounts, useSyncState } from '@/lib/queries';

/** One line that says whether your data is safely on the server. */
export function SyncBadge() {
  const sync = useSyncState();
  const counts = useOutboxCounts();
  const pending = counts?.pending ?? 0;
  const failed = counts?.failed.length ?? 0;

  let text: string;
  let tone = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  if (sync.status === 'offline') {
    text = pending > 0 ? `Offline · ${pending} waiting to sync` : 'Offline';
    tone = 'bg-amber-100 text-amber-900';
  } else if (sync.status === 'error') {
    text = 'Sync problem';
    tone = 'bg-red-100 text-red-900';
  } else if (sync.status === 'syncing') {
    text = 'Syncing…';
  } else if (failed > 0) {
    text = `${failed} change${failed > 1 ? 's' : ''} could not sync`;
    tone = 'bg-red-100 text-red-900';
  } else if (pending > 0) {
    text = `${pending} waiting to sync`;
  } else {
    text = sync.lastSyncedAt
      ? `Synced ${formatDateTime(sync.lastSyncedAt)}`
      : 'Saved on this device';
  }

  return (
    <span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
      {text}
    </span>
  );
}

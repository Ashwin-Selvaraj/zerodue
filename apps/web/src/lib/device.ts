import { DEVICE_ID_KEY, getDb } from './db';

let cached: string | undefined;

function newId(): string {
  return crypto.randomUUID();
}

/** A stable id for this browser, sent with every sync so the server can attribute writes. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const db = getDb();
  const stored = (await db.meta.get(DEVICE_ID_KEY))?.value;
  if (typeof stored === 'string') return (cached = stored);
  const created = newId();
  await db.meta.put({ key: DEVICE_ID_KEY, value: created });
  return (cached = created);
}

export function resetDeviceIdCacheForTests(): void {
  cached = undefined;
}

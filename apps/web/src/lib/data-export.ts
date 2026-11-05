import {
  BackupError,
  NOT_RESTORED,
  RESTORE_ORDER,
  buildDataDocument,
  decryptBackup,
  encryptBackup,
  isoDateIST,
  istPartsOf,
  parseDataDocument,
  parseEncryptedBackup,
  transactionsToCsv,
  type CsvTransaction,
  type DataTables,
  type ParsedData,
  type SyncEntity,
} from '@zerodue/shared';
import { getDb } from './db';
import { saveRecord } from './repo';

/** Export, backup and restore work from this device's copy, so they work offline too. */

export type ExportRange = 'month' | 'last-month' | 'fy' | 'last-fy' | 'all';

export const RANGE_LABELS: Record<ExportRange, string> = {
  month: 'This month',
  'last-month': 'Last month',
  fy: 'This financial year (Apr–Mar)',
  'last-fy': 'Last financial year',
  all: 'Everything',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Inclusive IST dates (YYYY-MM-DD) a range covers; empty for everything. */
export function rangeDates(range: ExportRange, now: Date): { from?: string; to?: string } {
  const { year, month } = istPartsOf(now);
  const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`;
  // the last day of a month is the day before the next one starts
  const before = (next: string) => isoDateIST(new Date(Date.parse(`${next}T00:00:00+05:30`) - 1));
  if (range === 'all') return {};
  if (range === 'month') {
    const next = month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1);
    return { from: monthStart(year, month), to: before(next) };
  }
  if (range === 'last-month') {
    const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
    return { from: monthStart(y, m), to: before(monthStart(year, month)) };
  }
  const fyStart = month >= 4 ? year : year - 1;
  const start = range === 'fy' ? fyStart : fyStart - 1;
  return { from: monthStart(start, 4), to: `${start + 1}-03-31` };
}

export function exportFilename(kind: string, extension: string, now: Date): string {
  return `zerodue-${kind}-${isoDateIST(now)}.${extension}`;
}

export async function transactionsCsv(range: ExportRange, now: Date): Promise<string> {
  const db = getDb();
  const [transactions, accounts, categories] = await Promise.all([
    db.transactions.toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
  ]);
  const { from, to } = rangeDates(range, now);
  const chosen = transactions.filter((t) => {
    if (t.status === 'IGNORED') return false;
    const day = isoDateIST(t.occurredAt);
    return (!from || day >= from) && (!to || day <= to);
  });
  return transactionsToCsv(chosen as CsvTransaction[], {
    accounts: new Map(accounts.map((a) => [a.id, a.name])),
    categories: new Map(categories.map((c) => [c.id, c.name])),
  });
}

/** Every record on this device as the readable export document. */
export async function dataDocumentText(now: Date): Promise<string> {
  const db = getDb();
  const tables: Partial<DataTables> = {};
  for (const entity of RESTORE_ORDER) {
    const rows = (await db.tableFor(entity).toArray()) as unknown as Record<string, unknown>[];
    tables[entity] = rows.filter((row) => !row.deletedAt);
  }
  return JSON.stringify(buildDataDocument(tables, now), null, 2);
}

export async function encryptedBackupText(passphrase: string, now: Date): Promise<string> {
  const sealed = await encryptBackup(await dataDocumentText(now), passphrase);
  return JSON.stringify(sealed);
}

/** Opens a chosen file, which may be an encrypted backup or a plain export. */
export async function readBackupFile(text: string, passphrase: string): Promise<ParsedData> {
  let format: unknown;
  try {
    format = (JSON.parse(text) as { format?: unknown }).format;
  } catch {
    throw new BackupError('NOT_A_BACKUP', 'This is not a ZeroDue file.');
  }
  if (format === 'zerodue-data') return parseDataDocument(text);
  return parseDataDocument(await decryptBackup(parseEncryptedBackup(text), passphrase));
}

export function isPlainExport(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: unknown }).format === 'zerodue-data';
  } catch {
    return false;
  }
}

export interface RestoreCounts {
  add: number;
  change: number;
  same: number;
}

export interface RestorePlan {
  counts: Partial<Record<SyncEntity, RestoreCounts>>;
  /** Records in the file that are not restored (due dates). */
  skipped: number;
}

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Existing = Record<string, unknown> | undefined;

const classify = (record: Record<string, unknown>, existing: Existing): keyof RestoreCounts => {
  if (!existing) return 'add';
  return Object.entries(record).every(([key, value]) => sameValue(value, existing[key]))
    ? 'same'
    : 'change';
};

export async function planRestore(data: ParsedData): Promise<RestorePlan> {
  const db = getDb();
  const counts: RestorePlan['counts'] = {};
  let skipped = 0;
  for (const entity of RESTORE_ORDER) {
    const rows = data.records[entity];
    if (NOT_RESTORED.includes(entity)) {
      skipped += rows.length;
      continue;
    }
    if (rows.length === 0) continue;
    const tally: RestoreCounts = { add: 0, change: 0, same: 0 };
    for (const row of rows) {
      const existing = (await db.tableFor(entity).get(row.id as string)) as Existing;
      tally[classify(row, existing)] += 1;
    }
    counts[entity] = tally;
  }
  return { counts, skipped };
}

export type RestoreMode = 'missing' | 'all';

/** Writes the file's records through the normal save path, so they sync like anything typed in. */
export async function applyRestore(
  data: ParsedData,
  mode: RestoreMode,
  onProgress?: (done: number, total: number) => void,
): Promise<{ written: number }> {
  const db = getDb();
  const work: [SyncEntity, Record<string, unknown>][] = [];
  for (const entity of RESTORE_ORDER) {
    if (NOT_RESTORED.includes(entity)) continue;
    for (const row of data.records[entity]) {
      const existing = (await db.tableFor(entity).get(row.id as string)) as Existing;
      const kind = classify(row, existing);
      if (kind === 'add' || (kind === 'change' && mode === 'all')) work.push([entity, row]);
    }
  }
  let done = 0;
  for (const [entity, row] of work) {
    await saveRecord(entity, row);
    onProgress?.(++done, work.length);
  }
  return { written: work.length };
}

'use client';

import {
  BackupError,
  MIN_PASSPHRASE_LENGTH,
  type ParsedData,
  type SyncEntity,
} from '@zerodue/shared';
import { useState, type FormEvent } from 'react';
import {
  RANGE_LABELS,
  applyRestore,
  dataDocumentText,
  encryptedBackupText,
  exportFilename,
  isPlainExport,
  planRestore,
  readBackupFile,
  transactionsCsv,
  type ExportRange,
  type RestoreMode,
  type RestorePlan,
} from '@/lib/data-export';
import { downloadFile } from '@/lib/download';
import { ui } from './ui';

const ENTITY_LABELS: Record<SyncEntity, string> = {
  account: 'Accounts',
  category: 'Categories',
  categoryRule: 'Category rules',
  transaction: 'Transactions',
  recurringItem: 'Bills',
  recurringAmountPeriod: 'Bill amounts',
  recurringOccurrence: 'Due dates',
  loan: 'Loans',
  loanLedgerEntry: 'Loan history',
  loanPlannedPayment: 'Planned payments',
  scenario: 'What-ifs',
  receivable: 'Money coming',
  goal: 'Goals',
  goalContribution: 'Goal contributions',
  allocationRule: 'Allocation rules',
};

/** Lets Excel read the rupee and Indian-language text as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.';

/** Export to a spreadsheet, an encrypted backup you keep yourself, and putting a backup back. */
export function DataCard() {
  const [range, setRange] = useState<ExportRange>('month');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [opened, setOpened] = useState<{ data: ParsedData; plan: RestorePlan } | null>(null);
  const [mode, setMode] = useState<RestoreMode>('missing');
  const [progress, setProgress] = useState<string | null>(null);

  async function run(work: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const done = await work();
      if (done) setStatus(done);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const exportCsv = () =>
    run(async () => {
      const now = new Date();
      const csv = await transactionsCsv(range, now);
      const rows = csv.trim().split('\r\n').length - 1;
      downloadFile(exportFilename('transactions', 'csv', now), 'text/csv;charset=utf-8', BOM + csv);
      return `Downloaded ${rows} transaction${rows === 1 ? '' : 's'}.`;
    });

  const exportJson = () =>
    run(async () => {
      const now = new Date();
      downloadFile(
        exportFilename('data', 'json', now),
        'application/json',
        await dataDocumentText(now),
      );
      return 'Downloaded. This file is not encrypted: keep it somewhere private.';
    });

  function backUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const passphrase = String(data.get('passphrase') ?? '');
    if (passphrase !== String(data.get('again') ?? '')) {
      setError('The two passphrases are different.');
      setStatus(null);
      return;
    }
    void run(async () => {
      const now = new Date();
      downloadFile(
        exportFilename('backup', 'json', now),
        'application/json',
        await encryptedBackupText(passphrase, now),
      );
      form.reset();
      return 'Backup downloaded. Keep the passphrase safe: without it the file cannot be opened.';
    });
  }

  async function chooseFile(chosen: File | undefined) {
    setOpened(null);
    setProgress(null);
    setError(null);
    setStatus(null);
    if (!chosen) return setFile(null);
    try {
      setFile({ name: chosen.name, text: await chosen.text() });
    } catch {
      setFile(null);
      setError('That file could not be read.');
    }
  }

  function openFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const passphrase = String(new FormData(event.currentTarget).get('passphrase') ?? '');
    void run(async () => {
      try {
        const data = await readBackupFile(file.text, passphrase);
        setOpened({ data, plan: await planRestore(data) });
      } catch (e) {
        if (e instanceof BackupError) throw e;
        throw new Error('That file could not be opened.');
      }
    });
  }

  const restore = () =>
    opened &&
    run(async () => {
      const { written } = await applyRestore(opened.data, mode, (done, total) =>
        setProgress(`Restoring ${done} of ${total}…`),
      );
      setOpened(null);
      setFile(null);
      setProgress(null);
      return written === 0
        ? 'Nothing to restore: everything in the file is already here.'
        : `Restored ${written} record${written === 1 ? '' : 's'}. They sync with your other devices as soon as you are online.`;
    });

  const toRestore = opened
    ? Object.entries(opened.plan.counts).filter(([, c]) => c.add + c.change + c.same > 0)
    : [];

  return (
    <section aria-label="Your data" className={ui.card}>
      <h2 className="mb-1 font-medium">Your data</h2>
      <p className={ui.muted + ' mb-3'}>
        Everything below works from the copy on this device, so it works offline too.
      </p>

      <h3 className="mb-2 text-sm font-medium">Spreadsheet (CSV)</h3>
      <div className="mb-4 flex flex-col gap-3">
        <label className={ui.label}>
          Transactions from
          <select
            className={ui.input}
            value={range}
            onChange={(e) => setRange(e.target.value as ExportRange)}
          >
            {Object.entries(RANGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={ui.secondary} onClick={exportCsv} disabled={busy}>
          Download CSV
        </button>
      </div>

      <h3 className="mb-2 text-sm font-medium">Encrypted backup</h3>
      <form onSubmit={backUp} className="mb-4 flex flex-col gap-3">
        <p className={ui.muted}>
          Saves everything into one file that only your passphrase can open. We cannot recover a
          lost passphrase.
        </p>
        <label className={ui.label}>
          Passphrase (at least {MIN_PASSPHRASE_LENGTH} characters)
          <input
            name="passphrase"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSPHRASE_LENGTH}
            required
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Type it again
          <input
            name="again"
            type="password"
            autoComplete="new-password"
            required
            className={ui.input}
          />
        </label>
        <button type="submit" className={ui.primary} disabled={busy}>
          Download backup
        </button>
      </form>

      <h3 className="mb-2 text-sm font-medium">Restore</h3>
      <div className="mb-4 flex flex-col gap-3">
        <label className={ui.label}>
          Backup or export file
          <input
            type="file"
            accept=".json,application/json"
            className={ui.input + ' py-2.5'}
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
        </label>
        {file && !opened && (
          <form onSubmit={openFile} className="flex flex-col gap-3">
            {!isPlainExport(file.text) && (
              <label className={ui.label}>
                Passphrase
                <input
                  name="passphrase"
                  type="password"
                  autoComplete="off"
                  required
                  className={ui.input}
                />
              </label>
            )}
            <button type="submit" className={ui.secondary} disabled={busy}>
              Open file
            </button>
          </form>
        )}
        {opened && (
          <div className="flex flex-col gap-3">
            <ul aria-label="In the file" className="flex flex-col gap-1 text-sm">
              {toRestore.map(([entity, c]) => (
                <li key={entity} className="flex justify-between gap-2">
                  <span>{ENTITY_LABELS[entity as SyncEntity]}</span>
                  <span className={ui.muted + ' tabular-nums'}>
                    {c.add} new · {c.change} different · {c.same} same
                  </span>
                </li>
              ))}
            </ul>
            {opened.plan.skipped > 0 && (
              <p className={ui.muted}>
                {opened.plan.skipped} due dates in the file are not restored: they are rebuilt from
                your bills.
              </p>
            )}
            {opened.data.problems.length > 0 && (
              <p className={ui.error}>
                {opened.data.problems.length} record
                {opened.data.problems.length === 1 ? ' is' : 's are'} not valid and will be left
                out.
              </p>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm">What to restore</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  className="h-5 w-5"
                  checked={mode === 'missing'}
                  onChange={() => setMode('missing')}
                />
                Only what is missing here
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  className="h-5 w-5"
                  checked={mode === 'all'}
                  onChange={() => setMode('all')}
                />
                Also put back records that differ (replaces newer edits)
              </label>
            </fieldset>
            <button type="button" className={ui.primary} onClick={restore} disabled={busy}>
              Restore
            </button>
          </div>
        )}
        {progress && <p role="status">{progress}</p>}
      </div>

      <h3 className="mb-2 text-sm font-medium">Everything as a file</h3>
      <p className={ui.muted + ' mb-3'}>
        A readable copy of all your records. It is not encrypted, so keep it private.
      </p>
      <button
        type="button"
        className={ui.secondary + ' w-full'}
        onClick={exportJson}
        disabled={busy}
      >
        Download all data
      </button>

      {status && (
        <p role="status" className={ui.muted + ' mt-3'}>
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className={ui.error + ' mt-3'}>
          {error}
        </p>
      )}
    </section>
  );
}

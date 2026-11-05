'use client';

import {
  COLUMN_FIELDS,
  detectLayout,
  emptyMapping,
  formatDate,
  formatINR,
  parseDelimited,
  parseStatement,
  type ColumnMapping,
  type TransactionDto,
} from '@zerodue/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ui } from '@/components/ui';
import { useAccounts } from '@/lib/queries';
import {
  existingTransactions,
  importRows,
  planImport,
  rowsBeforeBalanceDate,
} from '@/lib/statement-import';

const FIELD_LABELS: Record<(typeof COLUMN_FIELDS)[number], string> = {
  date: 'Date',
  description: 'Description',
  debit: 'Money out (withdrawal)',
  credit: 'Money in (deposit)',
  amount: 'Amount (one column)',
  drCr: 'Dr / Cr marker',
  balance: 'Balance',
  ref: 'Reference',
};
/** Balance is read for the file's sake only; nothing here uses it, so it is not offered. */
const SHOWN_FIELDS = COLUMN_FIELDS.filter((f) => f !== 'balance');
const PREVIEW_ROWS = 100;

export default function ImportPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping());
  const [detected, setDetected] = useState(true);
  const [existing, setExisting] = useState<TransactionDto[]>([]);
  const [includeKnown, setIncludeKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const chosenAccount = accountId || accounts?.[0]?.id || '';
  const account = accounts?.find((a) => a.id === chosenAccount);
  const headers = rows[headerRow] ?? [];

  const parsed = useMemo(
    () => (rows.length ? parseStatement(rows, headerRow, mapping) : { rows: [], problems: [] }),
    [rows, headerRow, mapping],
  );
  const planned = useMemo(
    () => planImport(parsed.rows, chosenAccount, existing),
    [parsed.rows, chosenAccount, existing],
  );
  const known = planned.filter((p) => p.duplicateOf).length;
  const toImport = planned.filter((p) => includeKnown || !p.duplicateOf);

  async function chooseFile(file: File | undefined) {
    setError(null);
    setDone(null);
    setRows([]);
    setFileName(null);
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError(
        'This is an Excel file. Open it in Excel or Sheets, save it as CSV, then choose that file.',
      );
      return;
    }
    const text = await file.text();
    if (text.includes('\u0000')) {
      setError('This does not look like a text file. Export the statement as CSV.');
      return;
    }
    const table = parseDelimited(text);
    const layout = detectLayout(table);
    setRows(table);
    setFileName(file.name);
    setHeaderRow(layout?.headerRow ?? 0);
    setMapping(layout?.mapping ?? emptyMapping());
    setDetected(layout !== null);
    setExisting(await existingTransactions());
  }

  function changeHeaderRow(next: number) {
    const row = Math.max(0, Math.min(rows.length - 1, next));
    setHeaderRow(row);
    setMapping(detectLayout([rows[row] ?? []])?.mapping ?? emptyMapping());
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const count = await importRows(
        toImport.map((p) => p.row),
        chosenAccount,
        (n, total) => setProgress(`Importing ${n} of ${total}…`),
      );
      setDone(count);
      setRows([]);
      setFileName(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const needsColumns =
    mapping.date === null ||
    (mapping.debit === null && mapping.credit === null && mapping.amount === null);

  return (
    <main className={ui.page}>
      <Link href="/more" className={ui.link}>
        ‹ More
      </Link>
      <h1 className={ui.title}>Import a statement</h1>
      <p className={ui.muted}>
        Choose a CSV exported from your bank. You see what will be added before anything is saved,
        and payments you already have (for example from messages) are skipped.
      </p>

      {done !== null && (
        <div role="status" className={ui.card}>
          <p className="font-medium">
            Imported {done} payment{done === 1 ? '' : 's'}.
          </p>
          <p className={ui.muted + ' mt-1'}>
            Ones a rule could not file are waiting in the Inbox for a category.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link href="/inbox" className={ui.secondary + ' flex items-center justify-center'}>
              Open Inbox
            </Link>
            <Link
              href="/transactions"
              className={ui.secondary + ' flex items-center justify-center'}
            >
              Transactions
            </Link>
          </div>
        </div>
      )}

      <section className={ui.card + ' flex flex-col gap-3'} aria-label="File">
        <label className={ui.label}>
          Account the statement is for
          <select
            className={ui.input}
            value={chosenAccount}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Statement file (CSV)
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className={ui.input + ' py-2.5'}
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
        </label>
      </section>

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      {fileName && (
        <>
          <details className={ui.card} open={!detected || needsColumns}>
            <summary className="min-h-12 cursor-pointer py-3 font-medium">
              Columns in {fileName}
            </summary>
            {!detected && (
              <p className={ui.error + ' mb-3'}>
                The columns were not found automatically. Choose which row holds the titles and
                which column is which.
              </p>
            )}
            <div className="flex flex-col gap-3">
              <label className={ui.label}>
                Row with the column titles
                <input
                  type="number"
                  min={1}
                  max={rows.length}
                  className={ui.input}
                  value={headerRow + 1}
                  onChange={(e) => changeHeaderRow(Number(e.target.value) - 1)}
                />
              </label>
              {SHOWN_FIELDS.map((field) => (
                <label key={field} className={ui.label}>
                  {FIELD_LABELS[field]}
                  <select
                    className={ui.input}
                    value={mapping[field] ?? ''}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        [field]: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">None</option>
                    {headers.map((title, index) => (
                      <option key={index} value={index}>
                        {index + 1}: {title || '(blank)'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>

          <section aria-label="Preview" className={ui.card}>
            <h2 className="mb-1 font-medium">Preview</h2>
            <p className={ui.muted + ' mb-3'}>
              {planned.length} payment{planned.length === 1 ? '' : 's'} found
              {known > 0 && `, ${known} already recorded`}
              {parsed.problems.length > 0 &&
                `, ${parsed.problems.length} row${parsed.problems.length === 1 ? '' : 's'} not understood`}
              .
            </p>
            {known > 0 && (
              <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={includeKnown}
                  onChange={(e) => setIncludeKnown(e.target.checked)}
                />
                Add the already recorded ones too
              </label>
            )}
            {account && rowsBeforeBalanceDate(parsed.rows, account.balanceAsOf) > 0 && (
              <p className={ui.muted + ' mb-3'}>
                {rowsBeforeBalanceDate(parsed.rows, account.balanceAsOf)} of these are from before{' '}
                {account.name}’s balance date, so they show in lists and reports but do not change
                its balance.
              </p>
            )}
            <ul className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
              {planned.slice(0, PREVIEW_ROWS).map(({ row, duplicateOf }) => {
                const skipped = duplicateOf && !includeKnown;
                return (
                  <li
                    key={row.row}
                    className={`flex items-start justify-between gap-3 py-2 ${skipped ? 'opacity-50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{row.merchant ?? row.description}</span>
                      <span className={ui.muted}>
                        {formatDate(`${row.date}T12:00:00+05:30`)}
                        {duplicateOf && ' · already recorded'}
                      </span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {row.type === 'INCOME' ? '+' : '−'}
                      {formatINR(row.amountPaise)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {planned.length > PREVIEW_ROWS && (
              <p className={ui.muted + ' mt-2'}>
                Showing the first {PREVIEW_ROWS}; all {toImport.length} will be added.
              </p>
            )}
            {parsed.problems.length > 0 && (
              <ul className={ui.error + ' mt-3 flex flex-col gap-1'}>
                {parsed.problems.slice(0, 5).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
                {parsed.problems.length > 5 && <li>…and {parsed.problems.length - 5} more.</li>}
              </ul>
            )}
            <button
              type="button"
              className={ui.primary + ' mt-4 w-full'}
              disabled={busy || toImport.length === 0 || !chosenAccount}
              onClick={() => void run()}
            >
              {busy
                ? (progress ?? 'Importing…')
                : `Import ${toImport.length} payment${toImport.length === 1 ? '' : 's'}`}
            </button>
          </section>
        </>
      )}
    </main>
  );
}

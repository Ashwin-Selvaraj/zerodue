import { toPaise } from '../money';
import type { ColumnMapping } from './columns';

export interface StatementRow {
  /** Row number among the non-empty rows of the file (the title row is counted), for messages. */
  row: number;
  /** YYYY-MM-DD. */
  date: string;
  type: 'EXPENSE' | 'INCOME';
  amountPaise: number;
  /** The bank's own text. */
  description: string;
  /** A guess at who was paid or who paid, taken from the narration. */
  merchant: string | null;
  vpa: string | null;
  /** The 12-digit UPI reference, from the narration or the reference column. */
  upiRef: string | null;
  balancePaise: number | null;
}

export interface ParsedStatement {
  rows: StatementRow[];
  problems: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const daysIn = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Day first, as Indian statements write it: 05/11/2026, 05-11-26, 5 Nov 2026, 2026-11-05. */
export function parseStatementDate(text: string): string | null {
  const value = text.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  let day: number;
  let month: number;
  let year: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (m)
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
    if (m[3]!.length === 2) year += 2000;
  } else if ((m = /^(\d{1,2})[\s/.-]([A-Za-z]{3})[A-Za-z]*[\s/.,-]+(\d{2}|\d{4})$/.exec(value))) {
    day = Number(m[1]);
    month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    year = Number(m[3]);
    if (m[3]!.length === 2) year += 2000;
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface ParsedAmount {
  paise: number;
  /** 'DR' or 'CR' when the cell said so (a suffix such as "1,200.00 Dr"), else null. */
  marker: 'DR' | 'CR' | null;
  negative: boolean;
}

/** An amount cell: "1,29,300.50", "₹ 450", "(450.00)", "-450", "1,200.00 Dr". Blank gives null; nonsense gives undefined. */
export function parseAmountCell(text: string): ParsedAmount | null | undefined {
  let value = text.trim();
  if (value === '' || value === '-') return null;
  let marker: ParsedAmount['marker'] = null;
  const suffix = /\s*(dr|cr)\.?$/i.exec(value);
  if (suffix) {
    marker = suffix[1]!.toLowerCase() === 'dr' ? 'DR' : 'CR';
    value = value.slice(0, suffix.index).trim();
  }
  let negative = false;
  const bracket = /^\((.*)\)$/.exec(value);
  if (bracket) {
    negative = true;
    value = bracket[1]!;
  }
  value = value.replace(/^(rs\.?|inr)\s*/i, '');
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  }
  try {
    const paise = toPaise(value);
    return { paise, marker, negative };
  } catch {
    return undefined;
  }
}

const NOISE = new Set([
  'upi',
  'payment',
  'paid',
  'pay',
  'sent',
  'received',
  'from',
  'to',
  'na',
  'imps',
  'neft',
  'rtgs',
  'nach',
  'atm',
  'pos',
  'ach',
  'debit',
  'credit',
]);
const UPI_REF = /(?<!\d)\d{12}(?!\d)/;

/** Who a narration is about, as far as can be told without knowing the bank's exact layout. */
export function readNarration(description: string): {
  merchant: string | null;
  vpa: string | null;
  upiRef: string | null;
} {
  const upiRef = UPI_REF.exec(description)?.[0] ?? null;
  const parts = description
    .split(/[/|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const vpa = parts.find((p) => /^[\w.-]+@[\w.-]+$/.test(p)) ?? null;
  const readable = parts.filter(
    (p) => !/^\d+$/.test(p) && !NOISE.has(p.toLowerCase()) && !p.includes('@') && p.length > 2,
  );
  const merchant = (readable[0] ?? description.trim()).slice(0, 120) || null;
  return { merchant, vpa, upiRef };
}

const cell = (row: string[], index: number | null): string =>
  index === null ? '' : (row[index] ?? '');

/**
 * Turns the rows below a statement's title row into transactions. Rows without a date (opening
 * balance lines, totals, notes) are skipped; rows that have a date but cannot be read are reported.
 */
export function parseStatement(
  rows: string[][],
  headerRow: number,
  mapping: ColumnMapping,
): ParsedStatement {
  const out: StatementRow[] = [];
  const problems: string[] = [];
  if (mapping.date === null) return { rows: out, problems: ['Choose the date column.'] };
  if (mapping.debit === null && mapping.credit === null && mapping.amount === null) {
    return { rows: out, problems: ['Choose the amount columns.'] };
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const rowNumber = r + 1;
    const dateText = cell(row, mapping.date);
    if (dateText.trim() === '') continue;
    const date = parseStatementDate(dateText);
    if (!date) {
      problems.push(`Row ${rowNumber}: the date "${dateText}" was not understood`);
      continue;
    }

    let type: StatementRow['type'] | null = null;
    let paise = 0;
    const debit = parseAmountCell(cell(row, mapping.debit));
    const credit = parseAmountCell(cell(row, mapping.credit));
    const amount = parseAmountCell(cell(row, mapping.amount));
    if (debit === undefined || credit === undefined || amount === undefined) {
      problems.push(`Row ${rowNumber}: an amount was not understood`);
      continue;
    }
    if (debit && debit.paise > 0 && credit && credit.paise > 0) {
      problems.push(`Row ${rowNumber}: both money out and money in are filled`);
      continue;
    }
    if (debit && debit.paise > 0) [type, paise] = ['EXPENSE', debit.paise];
    else if (credit && credit.paise > 0) [type, paise] = ['INCOME', credit.paise];
    else if (amount && amount.paise > 0) {
      const marker = cell(row, mapping.drCr).trim().toLowerCase();
      const fromColumn = marker.startsWith('d')
        ? 'EXPENSE'
        : marker.startsWith('c')
          ? 'INCOME'
          : null;
      const fromSuffix =
        amount.marker === 'DR' ? 'EXPENSE' : amount.marker === 'CR' ? 'INCOME' : null;
      type = fromColumn ?? fromSuffix ?? (amount.negative ? 'EXPENSE' : 'INCOME');
      paise = amount.paise;
    }
    if (type === null) continue; // a zero or empty amount: nothing moved

    const description = cell(row, mapping.description).replace(/\s+/g, ' ').trim();
    const narration = readNarration(description);
    const refCell = cell(row, mapping.ref);
    const balance = parseAmountCell(cell(row, mapping.balance));
    out.push({
      row: rowNumber,
      date,
      type,
      amountPaise: paise,
      description,
      merchant: narration.merchant,
      vpa: narration.vpa,
      upiRef: narration.upiRef ?? UPI_REF.exec(refCell)?.[0] ?? null,
      balancePaise: balance ? (balance.negative ? -balance.paise : balance.paise) : null,
    });
  }
  return { rows: out, problems };
}

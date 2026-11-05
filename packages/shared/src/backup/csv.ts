import { isoDateIST, istPartsOf } from '../dates';

/** A cell that starts with one of these is run as a formula by spreadsheets; a leading quote makes it text. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface CsvTransaction {
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amountPaise: number;
  occurredAt: string;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  merchant?: string | null;
  note?: string | null;
  tags?: string[];
  source: string;
  status: string;
}

/** Plain rupees with two decimals (no grouping), which every spreadsheet reads as a number. */
export const rupeesPlain = (paise: number): string => (paise / 100).toFixed(2);

const TXN_HEADER = [
  'Date',
  'Time',
  'Type',
  'Amount (INR)',
  'Account',
  'To account',
  'Category',
  'Merchant',
  'Note',
  'Tags',
  'Source',
  'Status',
];

export function transactionsToCsv(
  transactions: CsvTransaction[],
  names: { accounts: Map<string, string>; categories: Map<string, string> },
): string {
  const sorted = [...transactions].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return toCsv(
    TXN_HEADER,
    sorted.map((t) => {
      const { hour, minute } = istPartsOf(t.occurredAt);
      return [
        isoDateIST(t.occurredAt),
        `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        t.type,
        rupeesPlain(t.amountPaise),
        names.accounts.get(t.accountId) ?? '',
        t.toAccountId ? (names.accounts.get(t.toAccountId) ?? '') : '',
        t.categoryId ? (names.categories.get(t.categoryId) ?? '') : '',
        t.merchant,
        t.note,
        (t.tags ?? []).join(' '),
        t.source,
        t.status,
      ];
    }),
  );
}

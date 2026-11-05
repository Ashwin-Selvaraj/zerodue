/** Which column of a statement holds what. Each is a 0-based column index, or null when absent. */
export interface ColumnMapping {
  date: number | null;
  description: number | null;
  /** Money going out. */
  debit: number | null;
  /** Money coming in. */
  credit: number | null;
  /** One amount column, whose sign or Dr/Cr marker says the direction. */
  amount: number | null;
  /** A column saying Dr or Cr, used with `amount`. */
  drCr: number | null;
  balance: number | null;
  /** A bank reference or cheque number. */
  ref: number | null;
}

export const COLUMN_FIELDS = [
  'date',
  'description',
  'debit',
  'credit',
  'amount',
  'drCr',
  'balance',
  'ref',
] as const satisfies readonly (keyof ColumnMapping)[];

export const emptyMapping = (): ColumnMapping => ({
  date: null,
  description: null,
  debit: null,
  credit: null,
  amount: null,
  drCr: null,
  balance: null,
  ref: null,
});

const norm = (header: string): string =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const RULES: { field: keyof ColumnMapping; match: RegExp; prefer?: RegExp }[] = [
  // first, so "Dr/Cr" is not mistaken for a credit column
  { field: 'drCr', match: /^(dr cr|cr dr|type|debit credit|credit debit)$/ },
  { field: 'date', match: /\bdate\b/, prefer: /\b(transaction|txn|tran|posting)\b/ },
  { field: 'description', match: /\b(narration|description|particulars|remarks|details)\b/ },
  { field: 'debit', match: /\b(withdrawal|withdrawals|debit|debits|dr)\b(?!.*\bcr\b)/ },
  { field: 'credit', match: /\b(deposit|deposits|credit|credits|cr)\b(?!.*\bdr\b)/ },
  { field: 'amount', match: /\bamount\b/ },
  { field: 'balance', match: /\bbalance\b/ },
  { field: 'ref', match: /\b(chq|cheque|ref|reference|utr)\b/ },
];

export interface DetectedLayout {
  /** The row holding the column titles; data starts on the next one. */
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
}

/** Finds the title row of a statement (it is not always the first line) and guesses the columns. */
export function detectLayout(rows: string[][]): DetectedLayout | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const headers = rows[r]!;
    const mapping = emptyMapping();
    headers.forEach((raw, index) => {
      const title = norm(raw);
      if (!title) return;
      for (const rule of RULES) {
        if (!rule.match.test(title)) continue;
        const current = mapping[rule.field];
        const better =
          current === null ||
          (rule.prefer?.test(title) && !rule.prefer.test(norm(headers[current]!)));
        if (better) mapping[rule.field] = index;
        return;
      }
    });
    const hasMoney = mapping.debit !== null || mapping.credit !== null || mapping.amount !== null;
    if (mapping.date !== null && hasMoney) return { headerRow: r, headers, mapping };
  }
  return null;
}

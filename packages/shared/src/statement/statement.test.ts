import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  detectLayout,
  emptyMapping,
  parseAmountCell,
  parseDelimited,
  parseStatement,
  parseStatementDate,
  readNarration,
} from '..';

const STATEMENT = `Account Statement,,,,,,
Account No: XXXXXX1234,,,,,,
,,,,,,
Txn Date,Value Date,Description,Ref No./Cheque No.,Withdrawal Amt.,Deposit Amt.,Balance
01/11/2026,01/11/2026,"UPI/412345678901/Payment/shell@okaxis/SHELL, Indiranagar",,"450.00",,"59,550.00"
02/11/2026,02/11/2026,SALARY NOV,N123,,"60,000.00","1,19,550.00"
,,Closing balance,,,,"1,19,550.00"
03/11/2026,03/11/2026,ATM CASH,,"1,000.00",,"1,18,550.00"
`;

describe('delimited text', () => {
  it('reads quoted cells, embedded commas and newlines, a BOM and CRLF', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3';
    expect(parseDelimited(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
      ['1', '2', '3'],
    ]);
  });

  it('finds the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b\n1|2')).toBe('|');
    expect(detectDelimiter('a,b,c\n"1,5",2,3')).toBe(',');
    expect(detectDelimiter('just one column')).toBe(',');
    expect(parseDelimited('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('copes with a cell that ends the file inside quotes', () => {
    expect(parseDelimited('a,"b')).toEqual([['a', 'b']]);
  });
});

describe('column detection', () => {
  const rows = parseDelimited(STATEMENT);

  it('finds the title row below a preamble and the transaction date, not the value date', () => {
    const layout = detectLayout(rows)!;
    expect(layout.headerRow).toBe(2); // the blank line above it is dropped
    expect(layout.mapping).toEqual({
      date: 0,
      description: 2,
      debit: 4,
      credit: 5,
      amount: null,
      drCr: null,
      balance: 6,
      ref: 3,
    });
  });

  it('understands other common titles', () => {
    const layout = detectLayout([
      ['Date', 'Narration', 'Chq./Ref.No.', 'Dr', 'Cr', 'Closing Balance'],
    ])!;
    expect(layout.mapping).toMatchObject({
      date: 0,
      description: 1,
      ref: 2,
      debit: 3,
      credit: 4,
      balance: 5,
    });
    const single = detectLayout([['Posting Date', 'Particulars', 'Amount', 'Dr/Cr']])!;
    expect(single.mapping).toMatchObject({ date: 0, description: 1, amount: 2, drCr: 3 });
  });

  it('gives up when there is no title row', () => {
    expect(
      detectLayout([
        ['hello', 'world'],
        ['1', '2'],
      ]),
    ).toBeNull();
    expect(detectLayout([['Date', 'Notes']])).toBeNull();
  });
});

describe('dates', () => {
  it('reads day-first and named-month dates', () => {
    expect(parseStatementDate('05/11/2026')).toBe('2026-11-05');
    expect(parseStatementDate('5-11-26')).toBe('2026-11-05');
    expect(parseStatementDate('05.11.2026')).toBe('2026-11-05');
    expect(parseStatementDate('05 Nov 2026')).toBe('2026-11-05');
    expect(parseStatementDate('5-Nov-26')).toBe('2026-11-05');
    expect(parseStatementDate('2026-11-05')).toBe('2026-11-05');
    expect(parseStatementDate('05/11/2026 14:32:10')).toBe('2026-11-05');
  });

  it('refuses impossible and unreadable dates', () => {
    for (const bad of ['31/02/2026', '00/11/2026', '05/13/2026', 'tomorrow', '', '05 Foo 2026']) {
      expect(parseStatementDate(bad), bad).toBeNull();
    }
    expect(parseStatementDate('29/02/2028')).toBe('2028-02-29');
  });
});

describe('amount cells', () => {
  it('reads Indian grouping, currency marks, brackets, signs and Dr/Cr', () => {
    expect(parseAmountCell('1,29,300.50')).toEqual({
      paise: 12930050,
      marker: null,
      negative: false,
    });
    expect(parseAmountCell('₹ 450')).toMatchObject({ paise: 45000 });
    expect(parseAmountCell('Rs. 450.5')).toMatchObject({ paise: 45050 });
    expect(parseAmountCell('(450.00)')).toMatchObject({ paise: 45000, negative: true });
    expect(parseAmountCell('-450.00')).toMatchObject({ paise: 45000, negative: true });
    expect(parseAmountCell('1,200.00 Dr')).toEqual({
      paise: 120000,
      marker: 'DR',
      negative: false,
    });
    expect(parseAmountCell('300 CR.')).toMatchObject({ paise: 30000, marker: 'CR' });
  });

  it('tells blank from nonsense', () => {
    expect(parseAmountCell('')).toBeNull();
    expect(parseAmountCell(' - ')).toBeNull();
    expect(parseAmountCell('abc')).toBeUndefined();
    expect(parseAmountCell('1.234')).toBeUndefined();
  });
});

describe('narrations', () => {
  it('picks out who was paid, the VPA and the UPI reference', () => {
    expect(readNarration('UPI/412345678901/Payment/shell@okaxis/SHELL INDIRANAGAR')).toEqual({
      merchant: 'SHELL INDIRANAGAR',
      vpa: 'shell@okaxis',
      upiRef: '412345678901',
    });
    expect(readNarration('ATM CASH WDL')).toEqual({
      merchant: 'ATM CASH WDL',
      vpa: null,
      upiRef: null,
    });
    expect(readNarration('UPI/4123456789012').upiRef).toBeNull(); // 13 digits is not a UPI reference
    expect(readNarration('').merchant).toBeNull();
    expect(readNarration('x'.repeat(300)).merchant).toHaveLength(120);
  });
});

describe('statement rows', () => {
  const rows = parseDelimited(STATEMENT);
  const { headerRow, mapping } = detectLayout(rows)!;

  it('turns a statement into transactions, skipping lines that are not transactions', () => {
    const parsed = parseStatement(rows, headerRow, mapping);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({
      row: 4,
      date: '2026-11-01',
      type: 'EXPENSE',
      amountPaise: 45000,
      merchant: 'SHELL, Indiranagar',
      vpa: 'shell@okaxis',
      upiRef: '412345678901',
      balancePaise: 5955000,
    });
    expect(parsed.rows[1]).toMatchObject({ type: 'INCOME', amountPaise: 6000000, upiRef: null });
    expect(parsed.rows[2]).toMatchObject({
      type: 'EXPENSE',
      amountPaise: 100000,
      description: 'ATM CASH',
    });
  });

  it('reads one amount column with a Dr/Cr column, a suffix, or a sign', () => {
    const m = { ...emptyMapping(), date: 0, description: 1, amount: 2, drCr: 3 };
    const parsed = parseStatement(
      [
        ['Date', 'Narration', 'Amount', 'Dr/Cr'],
        ['01/11/2026', 'a', '100.00', 'DR'],
        ['02/11/2026', 'b', '200.00', 'Cr'],
        ['03/11/2026', 'c', '300.00 Dr', ''],
        ['04/11/2026', 'd', '-400.00', ''],
        ['05/11/2026', 'e', '500.00', ''],
      ],
      0,
      m,
    );
    expect(parsed.rows.map((r) => [r.type, r.amountPaise])).toEqual([
      ['EXPENSE', 10000],
      ['INCOME', 20000],
      ['EXPENSE', 30000],
      ['EXPENSE', 40000],
      ['INCOME', 50000],
    ]);
  });

  it('reports rows it cannot read, and keeps the rest', () => {
    const m = { ...emptyMapping(), date: 0, description: 1, debit: 2, credit: 3 };
    const parsed = parseStatement(
      [
        ['Date', 'Narration', 'Debit', 'Credit'],
        ['31/02/2026', 'bad date', '1', ''],
        ['01/11/2026', 'bad amount', 'abc', ''],
        ['02/11/2026', 'both', '5', '5'],
        ['03/11/2026', 'nothing moved', '0.00', ''],
        ['04/11/2026', 'fine', '7', ''],
      ],
      0,
      m,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.problems).toEqual([
      'Row 2: the date "31/02/2026" was not understood',
      'Row 3: an amount was not understood',
      'Row 4: both money out and money in are filled',
    ]);
  });

  it('says what is missing from the mapping', () => {
    expect(parseStatement(rows, headerRow, { ...mapping, date: null }).problems).toEqual([
      'Choose the date column.',
    ]);
    expect(
      parseStatement(rows, headerRow, { ...mapping, debit: null, credit: null }).problems,
    ).toEqual(['Choose the amount columns.']);
  });

  it('takes the UPI reference from the reference column when the narration has none', () => {
    const m = { ...emptyMapping(), date: 0, description: 1, debit: 2, ref: 3 };
    const parsed = parseStatement(
      [
        ['Date', 'Narration', 'Debit', 'Ref'],
        ['01/11/2026', 'PAID', '10', '412345678901'],
      ],
      0,
      m,
    );
    expect(parsed.rows[0]!.upiRef).toBe('412345678901');
    expect(parsed.rows[0]!.balancePaise).toBeNull();
  });

  it('keeps a negative balance', () => {
    const m = { ...emptyMapping(), date: 0, debit: 1, balance: 2 };
    const parsed = parseStatement(
      [
        ['Date', 'Debit', 'Bal'],
        ['01/11/2026', '10', '-5.00'],
      ],
      0,
      m,
    );
    expect(parsed.rows[0]!.balancePaise).toBe(-500);
  });
});

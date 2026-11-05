import { describe, expect, it } from 'vitest';
import {
  BackupError,
  buildDataDocument,
  csvCell,
  decryptBackup,
  encryptBackup,
  parseDataDocument,
  parseEncryptedBackup,
  rupeesPlain,
  toCsv,
  transactionsToCsv,
} from '..';

const FAST = 100_000; // keep the tests quick; the default is higher
const PASS = 'correct horse battery';

describe('encrypted backup', () => {
  it('round-trips text, including non-ASCII', async () => {
    const sealed = await encryptBackup('₹1,29,300 — राशन', PASS, FAST);
    expect(await decryptBackup(sealed, PASS)).toBe('₹1,29,300 — राशन');
  });

  it('never stores the text readably and uses a fresh salt and iv each time', async () => {
    const a = await encryptBackup('secret-merchant', PASS, FAST);
    const b = await encryptBackup('secret-merchant', PASS, FAST);
    expect(JSON.stringify(a)).not.toContain('secret-merchant');
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a wrong passphrase', async () => {
    const sealed = await encryptBackup('x', PASS, FAST);
    await expect(decryptBackup(sealed, 'wrong passphrase!')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });

  it('rejects a changed file, including changed key settings', async () => {
    const sealed = await encryptBackup('hello world', PASS, FAST);
    const flipped = {
      ...sealed,
      data: sealed.data.replace(/^./, sealed.data[0] === 'A' ? 'B' : 'A'),
    };
    await expect(decryptBackup(flipped, PASS)).rejects.toBeInstanceOf(BackupError);
    const retuned = { ...sealed, kdf: { ...sealed.kdf, iterations: FAST + 1 } };
    await expect(decryptBackup(retuned, PASS)).rejects.toBeInstanceOf(BackupError);
  });

  it('treats equivalent Unicode forms of a passphrase as the same', async () => {
    const sealed = await encryptBackup('x', 'pässphrase-long', FAST); // composed ä
    expect(await decryptBackup(sealed, 'pässphrase-long')).toBe('x'); // a + combining diaeresis
  });

  it('refuses short passphrases', async () => {
    await expect(encryptBackup('x', 'short', FAST)).rejects.toMatchObject({
      code: 'WEAK_PASSPHRASE',
    });
  });

  it('recognises its own files and refuses anything else', async () => {
    const sealed = await encryptBackup('x', PASS, FAST);
    expect(parseEncryptedBackup(JSON.stringify(sealed))).toEqual(sealed);
    expect(() => parseEncryptedBackup('not json')).toThrow(/not a ZeroDue backup/);
    expect(() => parseEncryptedBackup('{"a":1}')).toThrow(/not a ZeroDue backup/);
    expect(() => parseEncryptedBackup(JSON.stringify({ ...sealed, version: 2 }))).toThrow(/newer/);
    for (const iterations of [10, 50_000_000]) {
      const odd = { ...sealed, kdf: { ...sealed.kdf, iterations } };
      expect(() => parseEncryptedBackup(JSON.stringify(odd))).toThrow(/damaged/);
    }
  });

  it('reports undecodable data as a damaged file', async () => {
    const sealed = await encryptBackup('x', PASS, FAST);
    await expect(decryptBackup({ ...sealed, iv: '***' }, PASS)).rejects.toMatchObject({
      code: 'NOT_A_BACKUP',
    });
  });

  it('handles a large payload', async () => {
    const big = 'a'.repeat(300_000);
    expect(await decryptBackup(await encryptBackup(big, PASS, FAST), PASS)).toBe(big);
  });
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const META = {
  version: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  editedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
  lastDeviceId: null,
};

describe('data document', () => {
  const account = {
    id: ID(1),
    name: 'Salary',
    type: 'BANK',
    balancePaise: 500000,
    archived: false,
    ...META,
  };

  it('round-trips and drops sync metadata', () => {
    const doc = buildDataDocument({ account: [account] }, '2026-11-05T10:00:00Z');
    const parsed = parseDataDocument(JSON.stringify(doc));
    expect(parsed.exportedAt).toBe('2026-11-05T10:00:00.000Z');
    expect(parsed.problems).toEqual([]);
    expect(parsed.records.account).toEqual([
      expect.objectContaining({ id: ID(1), name: 'Salary', balancePaise: 500000 }),
    ]);
    expect(parsed.records.account[0]).not.toHaveProperty('version');
    expect(parsed.records.transaction).toEqual([]);
  });

  it('leaves out invalid rows and says which', () => {
    const doc = buildDataDocument(
      { account: [account, { ...account, id: ID(2), name: '' }, { name: 'No id', type: 'BANK' }] },
      '2026-11-05T10:00:00Z',
    );
    const parsed = parseDataDocument(JSON.stringify(doc));
    expect(parsed.records.account).toHaveLength(1);
    expect(parsed.problems).toEqual([
      'account #2 is not valid and was left out',
      'account #3 is not valid and was left out',
    ]);
  });

  it('refuses files that are not ours', () => {
    expect(() => parseDataDocument('nope')).toThrow(/not a ZeroDue data file/);
    expect(() => parseDataDocument('{"format":"other"}')).toThrow(/not a ZeroDue data file/);
    const newer = { ...buildDataDocument({}, '2026-11-05T10:00:00Z'), version: 2 };
    expect(() => parseDataDocument(JSON.stringify(newer))).toThrow(/newer/);
  });

  it('copes with a row that is not an object', () => {
    const doc = buildDataDocument({ account: [null as never] }, '2026-11-05T10:00:00Z');
    expect(parseDataDocument(JSON.stringify(doc)).problems).toHaveLength(1);
  });
});

describe('csv', () => {
  it('quotes cells that need it and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-5 off')).toBe("'-5 off");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('writes plain rupees', () => {
    expect(rupeesPlain(129300)).toBe('1293.00');
    expect(rupeesPlain(5)).toBe('0.05');
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n');
  });

  it('lists transactions oldest first with names and IST dates', () => {
    const csv = transactionsToCsv(
      [
        {
          type: 'EXPENSE',
          amountPaise: 45000,
          occurredAt: '2026-11-04T19:00:00Z', // 05 Nov 00:30 IST
          accountId: 'a',
          categoryId: 'c',
          merchant: 'SHELL, Indiranagar',
          tags: ['car', 'fuel'],
          source: 'SMS',
          status: 'POSTED',
        },
        {
          type: 'TRANSFER',
          amountPaise: 1000,
          occurredAt: '2026-11-01T04:30:00Z',
          accountId: 'a',
          toAccountId: 'b',
          source: 'MANUAL',
          status: 'POSTED',
        },
      ],
      {
        accounts: new Map([
          ['a', 'Salary'],
          ['b', 'Cash'],
        ]),
        categories: new Map([['c', 'Fuel']]),
      },
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Date,Time,Type,Amount (INR),Account,To account,Category,Merchant,Note,Tags,Source,Status',
    );
    expect(lines[1]).toBe('2026-11-01,10:00,TRANSFER,10.00,Salary,Cash,,,,,MANUAL,POSTED');
    expect(lines[2]).toBe(
      '2026-11-05,00:30,EXPENSE,450.00,Salary,,Fuel,"SHELL, Indiranagar",,car fuel,SMS,POSTED',
    );
  });

  it('leaves names blank when an account or category is gone', () => {
    const csv = transactionsToCsv(
      [
        {
          type: 'INCOME',
          amountPaise: 100,
          occurredAt: '2026-11-01T04:30:00Z',
          accountId: 'x',
          toAccountId: 'y',
          categoryId: 'z',
          source: 'MANUAL',
          status: 'POSTED',
        },
      ],
      { accounts: new Map(), categories: new Map() },
    );
    expect(csv.trim().split('\r\n')[1]).toBe('2026-11-01,10:00,INCOME,1.00,,,,,,,MANUAL,POSTED');
  });
});

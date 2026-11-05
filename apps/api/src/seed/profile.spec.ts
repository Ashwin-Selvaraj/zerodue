import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOps, parseProfile, stableId, type Lookup } from './profile';

const SEED_DIR = join(__dirname, '..', '..', 'seed');
const load = (file: string): unknown => JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8'));
const lookup: Lookup = {
  accountId: (name) => (name === 'Cash' ? '00000000-0000-4000-8000-000000000001' : undefined),
  categoryId: (name) => `cat-${name}`,
};
const NOW = '2026-11-05T10:00:00+05:30';

describe('seed profiles', () => {
  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));

  it.each(files)('%s is valid, and has no car loan', (file) => {
    const profile = parseProfile(load(file));
    expect(profile.loans.some((l) => /\bcar\b/i.test(l.name))).toBe(false);
    expect(profile.recurring.some((r) => /\bcar\b/i.test(r.name))).toBe(false);
  });

  it('includes the example profile', () => {
    expect(existsSync(join(SEED_DIR, 'profile.example.json'))).toBe(true);
  });
});

describe('stableId', () => {
  it('is a valid uuid and the same for the same input', () => {
    const id = stableId('loan', 'main');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableId('loan', 'main')).toBe(id);
    expect(stableId('loan', 'other')).not.toBe(id);
    expect(stableId('goal', 'main')).not.toBe(id);
  });
});

describe('parseProfile', () => {
  const base = { recurring: [], loans: [], goals: [], allocations: [] };
  const stream = {
    key: 'family',
    kind: 'INCOME',
    name: 'Family support',
    frequency: 'MONTHLY',
    startDate: '2026-12-01',
    earmarked: true,
    amounts: [{ from: '2026-12-01', rupees: 100 }],
  };
  const loan = {
    key: 'main',
    name: 'Main',
    kind: 'FLEXIBLE',
    outstanding: 1000,
    asOf: '2026-11-01',
  };

  it('fills in defaults for an empty profile', () => {
    expect(parseProfile({})).toMatchObject({ accounts: [], settled: [] });
  });

  it('rejects an allocation to a bill, loan or goal that does not exist', () => {
    const rule = { stream: 'family', target: 'LOAN', loan: 'main', startMonth: '2026-12-01' };
    expect(() => parseProfile({ ...base, allocations: [rule] })).toThrow('unknown bill');
    expect(() => parseProfile({ ...base, recurring: [stream], allocations: [rule] })).toThrow(
      'known loan',
    );
    expect(() =>
      parseProfile({ ...base, recurring: [stream], allocations: [{ ...rule, target: 'GOAL' }] }),
    ).toThrow('known goal');
    expect(() =>
      parseProfile({ ...base, recurring: [stream], loans: [loan], allocations: [rule] }),
    ).not.toThrow();
  });

  it('rejects a settled entry for an unknown bill, and bad shapes', () => {
    expect(() => parseProfile({ settled: [{ stream: 'nope', dueDate: '2026-11-04' }] })).toThrow(
      'unknown bill',
    );
    expect(() => parseProfile({ loans: [{ ...loan, asOf: 'yesterday' }] })).toThrow();
  });
});

describe('buildOps', () => {
  const profile = parseProfile(load('profile.example.json'));
  const ops = buildOps(profile, lookup, NOW);
  const of = (entity: string) => ops.filter((o) => o.entity === entity);

  it('sends every kind of record, in an order where references come first', () => {
    const order = ops.map((o) => o.entity);
    const first = (e: string) => order.indexOf(e);
    expect(first('account')).toBeLessThan(first('recurringItem'));
    expect(first('loan')).toBeLessThan(first('allocationRule'));
    expect(first('recurringItem')).toBeLessThan(first('recurringAmountPeriod'));
    expect(first('goal')).toBeLessThan(first('goalContribution'));
    expect(new Set(ops.map((o) => o.id)).size).toBe(ops.length);
  });

  it('converts rupees to paise and percent to basis points', () => {
    expect(of('loan')[0]!.data).toMatchObject({ outstandingPaise: 50_000_000, annualRateBps: 900 });
    const card = of('recurringAmountPeriod').filter((o) => o.data.amountPaise === 1_000_000);
    expect(card).toHaveLength(1);
  });

  it('marks earmarked income as not fixed, and links references by the same ids', () => {
    const family = of('recurringItem').find((o) => o.data.name === 'Family support')!;
    expect(family.data.fixedOutgoing).toBe(false);
    const rule = of('allocationRule')[0]!;
    expect(rule.data.recurringItemId).toBe(family.id);
    expect(rule.data.loanId).toBe(of('loan')[0]!.id);
    expect(rule.data.goalId).toBeNull();
  });

  it('uses the account that already exists instead of creating it again', () => {
    const cash = parseProfile({
      accounts: [{ name: 'Cash', type: 'CASH' }],
      recurring: [
        {
          key: 'a',
          kind: 'EXPENSE',
          name: 'A',
          frequency: 'ONE_TIME',
          startDate: '2026-11-30',
          account: 'Cash',
          amounts: [{ from: '2026-11-30', rupees: 1 }],
        },
      ],
    });
    const built = buildOps(cash, lookup, NOW);
    expect(built.filter((o) => o.entity === 'account')).toHaveLength(0);
    expect(built.find((o) => o.entity === 'recurringItem')!.data.accountId).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('refuses a category that does not exist', () => {
    const profileWithBadCategory = parseProfile({
      recurring: [
        {
          key: 'a',
          kind: 'EXPENSE',
          name: 'A',
          frequency: 'ONE_TIME',
          startDate: '2026-11-30',
          category: 'Nope',
          amounts: [{ from: '2026-11-30', rupees: 1 }],
        },
      ],
    });
    expect(() =>
      buildOps(profileWithBadCategory, { ...lookup, categoryId: () => undefined }, NOW),
    ).toThrow('No category called "Nope"');
  });
});

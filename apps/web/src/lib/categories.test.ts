import type { CategoryDto } from '@zerodue/shared';
import { describe, expect, it } from 'vitest';
import { nameMap, pickableCategories } from './categories';

const cat = (id: string, over: Partial<CategoryDto>): CategoryDto => ({
  id,
  name: id,
  kind: 'EXPENSE',
  parentId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  quickPick: false,
  version: 1,
  createdAt: '',
  updatedAt: '',
  editedAt: '',
  deletedAt: null,
  lastDeviceId: null,
  ...over,
});

const all = [
  cat('Misc', { quickPick: true, sortOrder: 6 }),
  cat('Fuel', { quickPick: true, sortOrder: 0 }),
  cat('Gold', { sortOrder: 4 }),
  cat('Income', { kind: 'INCOME', sortOrder: 7 }),
  cat('Salary', { kind: 'INCOME', parentId: 'Income' }),
  cat('Refunds', { kind: 'BOTH', sortOrder: 9 }),
];

describe('pickableCategories', () => {
  it('lists expense categories with quick-picks first, then by order', () => {
    expect(pickableCategories(all, 'EXPENSE').map((c) => c.id)).toEqual([
      'Fuel',
      'Misc',
      'Gold',
      'Refunds',
    ]);
  });

  it('lists income sub-categories instead of their group', () => {
    expect(pickableCategories(all, 'INCOME').map((c) => c.id)).toEqual(['Salary', 'Refunds']);
  });

  it('offers everything for a transfer except groups', () => {
    expect(pickableCategories(all, 'TRANSFER').map((c) => c.id)).not.toContain('Income');
  });
});

describe('nameMap', () => {
  it('maps ids to names and tolerates missing data', () => {
    expect(nameMap([{ id: 'a', name: 'Alpha' }]).get('a')).toBe('Alpha');
    expect(nameMap(undefined).size).toBe(0);
  });
});

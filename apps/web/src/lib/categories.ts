import type { CategoryDto } from '@zerodue/shared';

/**
 * Categories you can actually pick for a transaction type: sub-categories are listed instead of the
 * group they belong to ("Salary", not "Income"), and quick-pick ones come first.
 */
export function pickableCategories(
  categories: CategoryDto[],
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER',
): CategoryDto[] {
  const parents = new Set(categories.map((c) => c.parentId).filter(Boolean));
  return categories
    .filter((c) => !parents.has(c.id))
    .filter((c) => type === 'TRANSFER' || c.kind === 'BOTH' || c.kind === type)
    .sort((a, b) => Number(b.quickPick) - Number(a.quickPick) || a.sortOrder - b.sortOrder);
}

export function nameMap<T extends { id: string; name: string }>(
  rows: T[] | undefined,
): Map<string, string> {
  return new Map((rows ?? []).map((row) => [row.id, row.name]));
}

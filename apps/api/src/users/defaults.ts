import type { Prisma } from '@prisma/client';
import { DEFAULT_ACCOUNT_NAME, DEFAULT_CATEGORIES } from '@zerodue/shared';
import { randomUUID } from 'node:crypto';

/** What every new user starts with: the seed categories and a Cash account, so quick-add works at once. */
export async function seedUserDefaults(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  let sortOrder = 0;
  for (const category of DEFAULT_CATEGORIES) {
    const parentId = randomUUID();
    const { children = [], ...parent } = category;
    await tx.category.create({ data: { id: parentId, userId, sortOrder: sortOrder++, ...parent } });
    for (const [index, child] of children.entries()) {
      await tx.category.create({
        data: { id: randomUUID(), userId, parentId, sortOrder: index, ...child },
      });
    }
  }
  await tx.account.create({
    data: { id: randomUUID(), userId, name: DEFAULT_ACCOUNT_NAME, type: 'CASH' },
  });
}

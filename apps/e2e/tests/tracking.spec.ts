import { expect, test } from '@playwright/test';
import { addExpense, failOnPageErrors, serverTransactions, signUp } from './helpers';

test('an expense is saved, listed, kept after a reload and reaches the server', async ({
  page,
  request,
}) => {
  failOnPageErrors(page);
  const email = await signUp(page);

  await addExpense(page, '450', 'Fuel');
  await expect(page.getByText(/₹450\b/).first()).toBeVisible();
  await expect(page.getByText(/^Synced /)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/₹450\b/).first()).toBeVisible();

  const onServer = await serverTransactions(request, email);
  expect(onServer).toHaveLength(1);
  expect(onServer[0]).toMatchObject({ amountPaise: 45000, type: 'EXPENSE' });
  expect(onServer[0]!.categoryId).not.toBeNull();
});

test('data entered offline is kept and sent when the connection returns', async ({
  page,
  context,
  request,
}) => {
  failOnPageErrors(page);
  const email = await signUp(page);
  // load the screens first so they work without a network
  await page.getByRole('link', { name: 'Transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/^Offline/)).toBeVisible();
  await addExpense(page, '120', 'Fuel');
  await expect(page.getByText(/₹120\b/).first()).toBeVisible();
  await expect(page.getByText(/Offline · 1 waiting to sync/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(/^Synced /)).toBeVisible({ timeout: 40_000 });
  const onServer = await serverTransactions(request, email);
  expect(onServer.map((t) => t.amountPaise)).toEqual([12000]);
});

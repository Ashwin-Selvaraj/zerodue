import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addExpense, failOnPageErrors, signUp } from './helpers';

test('CSV export and an encrypted backup download', async ({ page }) => {
  failOnPageErrors(page);
  await signUp(page);
  await addExpense(page, '450', 'Fuel');
  await page.getByRole('link', { name: 'More' }).click();
  const data = page.getByRole('region', { name: 'Your data' });

  await data.getByLabel('Transactions from').selectOption({ label: 'Everything' });
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^zerodue-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvText = await readFile((await csv.path())!, 'utf8');
  expect(csvText).toContain('Amount (INR)');
  expect(csvText).toContain('450.00');
  expect(csvText).toContain('Fuel');

  await data
    .getByLabel(/^Passphrase/)
    .first()
    .fill('correct-horse-battery');
  await data.getByLabel('Type it again').fill('correct-horse-battery');
  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backupText = await readFile((await backup.path())!, 'utf8');
  expect(JSON.parse(backupText)).toMatchObject({ format: 'zerodue-backup', cipher: 'AES-256-GCM' });
  expect(backupText).not.toContain('Fuel');

  // and it opens again with the passphrase
  await data.getByLabel('Backup or export file').setInputFiles((await backup.path()) as string);
  await data.getByLabel('Passphrase', { exact: true }).fill('correct-horse-battery');
  await data.getByRole('button', { name: 'Open file' }).click();
  await expect(data.getByText(/Transactions/).first()).toBeVisible();
  await expect(data.getByText(/1 same/).first()).toBeVisible();
});

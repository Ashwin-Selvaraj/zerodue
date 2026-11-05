import { expect, test } from '@playwright/test';
import { addExpense, failOnPageErrors, serverTransactions, signUp } from './helpers';

/** DD/MM/YYYY in India for a day some days ago, as a bank statement writes it. */
const statementDate = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
  });

test('a CSV statement is previewed, skips what is already recorded, and is imported', async ({
  page,
  request,
}) => {
  failOnPageErrors(page);
  const email = await signUp(page);
  await addExpense(page, '450', 'Fuel'); // already recorded, as if captured from a message

  const csv = [
    'Account Statement,,,,',
    'Txn Date,Description,Withdrawal Amt.,Deposit Amt.,Balance',
    `${statementDate(0)},"UPI/412345678901/Payment/shell@okaxis/SHELL",450.00,,"59,550.00"`,
    `${statementDate(2)},SALARY NOV,,"60,000.00","1,19,550.00"`,
    `${statementDate(1)},ATM CASH,"1,000.00",,"1,18,550.00"`,
    ',,,,',
  ].join('\n');

  await page.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Import statement' }).click();
  await page.getByLabel('Statement file (CSV)').setInputFiles({
    name: 'statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByText('3 payments found, 1 already recorded.')).toBeVisible();
  await expect(preview.getByText(/already recorded$/)).toBeVisible();
  await preview.getByRole('button', { name: 'Import 2 payments' }).click();
  await expect(page.getByText('Imported 2 payments.')).toBeVisible();

  await expect
    .poll(async () => (await serverTransactions(request, email)).length, { timeout: 30_000 })
    .toBe(3);
  const amounts = (await serverTransactions(request, email))
    .map((t) => t.amountPaise)
    .sort((a, b) => a - b);
  expect(amounts).toEqual([45000, 100000, 6000000]);

  // the same file again finds everything already there
  await page.getByLabel('Statement file (CSV)').setInputFiles({
    name: 'statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText('3 payments found, 3 already recorded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 payments' })).toBeDisabled();
});

test('an Excel file is turned away with what to do instead', async ({ page }) => {
  failOnPageErrors(page);
  await signUp(page);
  await page.goto('/import');
  await page.getByLabel('Statement file (CSV)').setInputFiles({
    name: 'statement.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from('not really'),
  });
  await expect(page.getByText(/save it as CSV/)).toBeVisible();
});

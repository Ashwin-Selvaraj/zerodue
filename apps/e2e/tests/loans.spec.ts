import { expect, test } from '@playwright/test';
import { failOnPageErrors, signUp } from './helpers';

test('a loan can be added and shows what is owed and when it ends', async ({ page }) => {
  failOnPageErrors(page);
  await signUp(page);

  await page.goto('/loans/new');
  await page.getByLabel('Name').fill('Test loan');
  await page.getByLabel('What you owe today (₹)').fill('500000');
  await page.getByLabel('Interest rate (% a year)').fill('9');
  await page.getByRole('button', { name: 'Add loan' }).click();

  await expect(page.getByRole('heading', { name: 'Test loan' })).toBeVisible();
  await expect(page.getByText('₹5,00,000').first()).toBeVisible();

  await page.goto('/loans');
  await expect(page.getByText('Test loan')).toBeVisible();
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: /plan/i }).first()).toBeVisible();
});

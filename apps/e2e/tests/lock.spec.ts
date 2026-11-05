import { expect, test } from '@playwright/test';
import { failOnPageErrors, signUp } from './helpers';

test('the app lock hides the app until the PIN is entered', async ({ page }) => {
  failOnPageErrors(page);
  await signUp(page);
  await page.getByRole('link', { name: 'More' }).click();

  const lock = page.getByRole('region', { name: 'App lock' });
  await lock.getByLabel('New PIN (4 to 12 digits)').fill('482913');
  await lock.getByLabel('Type it again').fill('482913');
  await lock.getByRole('button', { name: 'Turn on app lock' }).click();
  await lock.getByRole('button', { name: 'Lock now' }).click();

  const heading = page.getByRole('heading', { name: 'ZeroDue is locked' });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('heading', { name: 'More' })).toBeHidden();

  await page.getByLabel('PIN').fill('111111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That is not your PIN.')).toBeVisible();

  await page.getByLabel('PIN').fill('482913');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(heading).toBeHidden();
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();

  await page.reload();
  await expect(heading).toBeVisible();
});

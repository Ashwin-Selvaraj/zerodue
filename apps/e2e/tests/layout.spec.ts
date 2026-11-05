import { expect, test } from '@playwright/test';
import { failOnPageErrors, signUp } from './helpers';

const PAGES = [
  '/',
  '/transactions',
  '/plan',
  '/loans',
  '/goals',
  '/bills',
  '/reports',
  '/inbox',
  '/more',
];

for (const width of [360, 1280]) {
  test(`no screen scrolls sideways at ${width}px wide`, async ({ page }) => {
    failOnPageErrors(page);
    await page.setViewportSize({ width, height: 800 });
    await signUp(page);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
}

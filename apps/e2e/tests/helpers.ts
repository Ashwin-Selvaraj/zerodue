import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:4000';
export const PASSWORD = 'e2e-password-1234';

/** Creates a brand-new account through the sign-up screen and waits for the app to open. */
export async function signUp(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@zerodue.test`;
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  return email;
}

export async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { accessToken: string }).accessToken;
}

export async function serverTransactions(
  request: APIRequestContext,
  email: string,
): Promise<{ amountPaise: number; type: string; categoryId: string | null }[]> {
  const token = await apiToken(request, email);
  const response = await request.get(`${API}/transactions?limit=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items?: never[] } | never[];
  return (Array.isArray(body) ? body : (body.items ?? [])) as never;
}

/** Quick Add: type the amount on the keypad, pick a category, save. */
export async function addExpense(page: Page, digits: string, category: string): Promise<void> {
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  for (const digit of digits) {
    await page
      .getByRole('group', { name: 'Keypad' })
      .getByRole('button', { name: digit, exact: true })
      .click();
  }
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
}

/** Fails the test if the page throws an uncaught error. */
export function failOnPageErrors(page: Page): void {
  page.on('pageerror', (error) => {
    throw error;
  });
}

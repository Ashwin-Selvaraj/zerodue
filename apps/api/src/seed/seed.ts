import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildOps, parseProfile, stableId } from './profile';

/**
 * Loads a profile into a running API as one user, through the same endpoints the app uses.
 *
 *   pnpm --filter @zerodue/api seed -- --profile seed/profile.local.json --email you@example.com
 *
 * The password comes from SEED_PASSWORD (prompting would hang in scripts). The user is created if
 * they don't exist. If they already have loans or bills the seed stops, because loading it again would
 * overwrite what they have changed since; pass --force to do it anyway.
 */

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function call<T>(
  base: string,
  path: string,
  init: RequestInit,
  token?: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function main(): Promise<void> {
  const base = arg('api', 'http://localhost:4000');
  const email = arg('email');
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('Set SEED_PASSWORD to the account password');
  const profile = parseProfile(JSON.parse(readFileSync(arg('profile'), 'utf8')));

  let session = await call<{ accessToken: string }>(base, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (session.status === 409 || session.status === 403) {
    session = await call(base, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }
  if (session.status >= 300) throw new Error(`Could not sign in (HTTP ${session.status})`);
  const token = session.body.accessToken;

  const have = await Promise.all(
    ['/loans', '/recurring'].map(
      async (path) => (await call<unknown[]>(base, path, {}, token)).body.length,
    ),
  );
  if (have.some((n) => n > 0) && !process.argv.includes('--force')) {
    console.error(
      'This user already has loans or bills. Nothing was changed (use --force to overwrite).',
    );
    process.exit(2);
  }

  const accounts = (await call<{ id: string; name: string }[]>(base, '/accounts', {}, token)).body;
  const categories = (await call<{ id: string; name: string }[]>(base, '/categories', {}, token))
    .body;
  const ops = buildOps(
    profile,
    {
      accountId: (name) => accounts.find((a) => a.name === name)?.id,
      categoryId: (name) => categories.find((c) => c.name === name)?.id,
    },
    new Date().toISOString(),
  );

  const pushed = await call<{ results: { entity: string; status: string; error?: string }[] }>(
    base,
    '/sync/push',
    { method: 'POST', body: JSON.stringify({ deviceId: randomUUID(), ops }) },
    token,
  );
  if (pushed.status >= 300) throw new Error(`Push failed (HTTP ${pushed.status})`);
  const rejected = pushed.body.results.filter((r) => r.status === 'rejected');
  for (const r of rejected) console.error(`Rejected ${r.entity}: ${r.error}`);
  console.log(`Sent ${ops.length} records (${rejected.length} rejected).`);

  if (profile.settled.length > 0) {
    const due = (
      await call<{ id: string; recurringItemId: string; dueDate: string; status: string }[]>(
        base,
        '/recurring/occurrences',
        {},
        token,
      )
    ).body;
    for (const entry of profile.settled) {
      const item = stableId('recurring', entry.stream);
      const found = due.find((o) => o.recurringItemId === item && o.dueDate === entry.dueDate);
      if (!found) console.error(`No due date ${entry.dueDate} for ${entry.stream}`);
      else if (found.status !== 'PAID') {
        await call(
          base,
          `/recurring/occurrences/${found.id}/mark-paid`,
          { method: 'POST', body: '{}' },
          token,
        );
      }
    }
  }
  console.log('Done.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

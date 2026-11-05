import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isIdleTooLong,
  readLock,
  removeLock,
  setLockTimeout,
  setPin,
  tryPin,
  waitAfterFailures,
} from './app-lock';
import { resetDbForTests } from './db';

let n = 0;
beforeEach(() => {
  resetDbForTests(`lock-${++n}`);
});

describe('app lock', () => {
  it('starts off', async () => {
    expect(await readLock()).toBeNull();
    expect(await tryPin('1234')).toMatchObject({ ok: false, reason: 'none' });
  });

  it('accepts the right PIN and stores only a hash', async () => {
    await setPin('482913', 60);
    const stored = await readLock();
    expect(JSON.stringify(stored)).not.toContain('482913');
    expect(stored?.timeoutSec).toBe(60);
    expect(await tryPin('482913')).toEqual({ ok: true });
  });

  it('rejects a wrong PIN, and a PIN of the wrong shape', async () => {
    await setPin('482913', 60);
    expect(await tryPin('000000')).toMatchObject({ ok: false, reason: 'wrong', waitMs: 0 });
    await expect(setPin('12', 60)).rejects.toThrow(/4 to 12 digits/);
    await expect(setPin('12ab', 60)).rejects.toThrow(/4 to 12 digits/);
  });

  it('makes repeated misses wait, even for the right PIN, and survives a reload', async () => {
    await setPin('482913', 60);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) await tryPin('000000', t0);
    const fifth = await tryPin('000000', t0);
    expect(fifth).toMatchObject({ ok: false, reason: 'wrong', waitMs: 30_000 });
    expect(await tryPin('482913', t0 + 10_000)).toMatchObject({
      ok: false,
      reason: 'waiting',
      waitMs: 20_000,
    });
    expect(await tryPin('482913', t0 + 30_000)).toEqual({ ok: true });
    expect((await readLock())?.failures).toBe(0);
  });

  it('grows the wait and caps it at an hour', () => {
    expect([0, 4, 5, 6, 7].map(waitAfterFailures)).toEqual([0, 0, 30_000, 60_000, 120_000]);
    expect(waitAfterFailures(40)).toBe(3_600_000);
  });

  it('changes the timeout without touching the PIN, and can be removed', async () => {
    await setLockTimeout(300); // nothing to change yet
    expect(await readLock()).toBeNull();
    await setPin('482913', 60);
    await setLockTimeout(300);
    expect((await readLock())?.timeoutSec).toBe(300);
    expect(await tryPin('482913')).toEqual({ ok: true });
    await removeLock();
    expect(await readLock()).toBeNull();
  });

  it('decides when the app has been away too long', () => {
    expect(isIdleTooLong(1000, 0, 0)).toBe(true);
    expect(isIdleTooLong(59_999, 0, 60)).toBe(false);
    expect(isIdleTooLong(60_000, 0, 60)).toBe(true);
  });
});

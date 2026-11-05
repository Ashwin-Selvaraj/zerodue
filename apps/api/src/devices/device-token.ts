import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Device tokens start with this, so the guard can tell them from a browser's JWT. */
export const DEVICE_TOKEN_PREFIX = 'zd_dev_';

/** No 0/O or 1/I/L, so a code read off a screen is not misheard. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function newPairingCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}

/** 256 random bits. Only its hash is stored; the phone keeps the token. */
export function newDeviceToken(): string {
  return DEVICE_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

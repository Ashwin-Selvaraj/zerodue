import { z } from 'zod';

/**
 * Passphrase-protected backups: PBKDF2-SHA256 turns the passphrase into an AES-256-GCM key.
 * Only Web Crypto is used, so the same code runs in the browser and in Node.
 */

export const BACKUP_FORMAT = 'zerodue-backup';
export const KDF_ITERATIONS = 600_000;
/** A file asking for fewer is too weak to trust; far more is a way to make the app hang. */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;
export const MIN_PASSPHRASE_LENGTH = 10;

export type BackupErrorCode =
  'NOT_A_BACKUP' | 'UNSUPPORTED' | 'WRONG_PASSPHRASE' | 'WEAK_PASSPHRASE';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export const encryptedBackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  kdf: z.object({
    name: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int(),
    salt: z.string().min(1),
  }),
  cipher: z.literal('AES-256-GCM'),
  iv: z.string().min(1),
  data: z.string().min(1),
});
export type EncryptedBackup = z.infer<typeof encryptedBackupSchema>;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    throw new BackupError('NOT_A_BACKUP', 'This file is damaged.');
  }
}

/** Everything that decides the key is also authenticated, so editing it fails decryption. */
const additionalData = (version: number, iterations: number, salt: string): Uint8Array =>
  encoder.encode(`${BACKUP_FORMAT}|${version}|PBKDF2-SHA256|${iterations}|${salt}`);

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(
  plaintext: string,
  passphrase: string,
  iterations = KDF_ITERATIONS,
): Promise<EncryptedBackup> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupError(
      'WEAK_PASSPHRASE',
      `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`,
    );
  }
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, fromBase64(salt), iterations);
  const sealed = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      additionalData: additionalData(1, iterations, salt),
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    format: BACKUP_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations, salt },
    cipher: 'AES-256-GCM',
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(sealed)),
  };
}

/** Reads a file's text and checks it is one of ours, without needing the passphrase. */
export function parseEncryptedBackup(text: string): EncryptedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError('NOT_A_BACKUP', 'This is not a ZeroDue backup file.');
  }
  const parsed = encryptedBackupSchema.safeParse(json);
  if (!parsed.success) throw new BackupError('NOT_A_BACKUP', 'This is not a ZeroDue backup file.');
  const { version, kdf } = parsed.data;
  if (version !== 1) {
    throw new BackupError('UNSUPPORTED', 'This backup is from a newer version of ZeroDue.');
  }
  if (kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) {
    throw new BackupError('NOT_A_BACKUP', 'This backup file looks damaged.');
  }
  return parsed.data;
}

export async function decryptBackup(backup: EncryptedBackup, passphrase: string): Promise<string> {
  const { kdf, version } = backup;
  const iv = fromBase64(backup.iv);
  const data = fromBase64(backup.data);
  const key = await deriveKey(passphrase, fromBase64(kdf.salt), kdf.iterations);
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(version, kdf.iterations, kdf.salt) },
      key,
      data,
    );
    return new TextDecoder().decode(opened);
  } catch {
    // AES-GCM cannot tell a wrong passphrase from a changed file
    throw new BackupError('WRONG_PASSPHRASE', 'Wrong passphrase, or the file has been changed.');
  }
}

import { z } from 'zod';
import { instantSchema, positivePaiseSchema, uuidSchema } from './records';

/** What the Android companion sends for each payment message it reads. */

export const parsedPaymentSchema = z.object({
  direction: z.enum(['DEBIT', 'CREDIT']),
  amountPaise: positivePaiseSchema,
  merchant: z.string().trim().min(1).max(120).optional(),
  vpa: z.string().trim().min(3).max(120).optional(),
  /** The last 3 or 4 digits of the account or card, as the message shows them. */
  accountTail: z
    .string()
    .regex(/^\d{3,4}$/)
    .optional(),
  upiRef: z.string().trim().min(6).max(40).optional(),
  occurredAt: instantSchema.optional(),
  channel: z.enum(['SMS_BANK', 'SMS_UPI']),
  confidence: z.number().min(0).max(1),
});
export type ParsedPaymentDto = z.infer<typeof parsedPaymentSchema>;

export const ingestSmsSchema = z.object({
  /** Made on the phone for each message, so a retry is recognised. */
  clientEventId: uuidSchema,
  senderId: z.string().trim().min(1).max(40),
  receivedAt: instantSchema,
  /** Salted SHA-256 of the message text. The same message always has the same hash on one phone. */
  messageHash: z.string().min(8).max(128),
  /** Only sent if the user chose to store message text. */
  rawBody: z.string().max(1000).optional(),
  parsed: parsedPaymentSchema,
});
export type IngestSmsInput = z.infer<typeof ingestSmsSchema>;

export const ingestBatchSchema = z.object({ events: z.array(ingestSmsSchema).min(1).max(50) });
export type IngestBatchInput = z.infer<typeof ingestBatchSchema>;

export const quickPickSchema = z.object({ id: uuidSchema, name: z.string() });

export const ingestResultSchema = z.object({
  transactionId: uuidSchema,
  /** Money out or money in, so the notification knows whether to offer expense categories. */
  type: z.enum(['EXPENSE', 'INCOME']),
  /** The payment was already known (a retry, or the same payment seen in another message). */
  deduped: z.boolean(),
  status: z.enum(['PENDING_CATEGORY', 'POSTED', 'IGNORED']),
  categoryId: uuidSchema.nullable(),
  quickPicks: z.array(quickPickSchema),
  /** For the notification: "₹450 paid to Shell". */
  title: z.string(),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

export const ingestBatchResultSchema = z.object({
  results: z.array(
    z.object({
      clientEventId: uuidSchema,
      result: ingestResultSchema.optional(),
      error: z.string().optional(),
    }),
  ),
});

export const ingestConfigSchema = z.object({
  allowList: z.array(z.string()),
  quickPicks: z.array(quickPickSchema),
});

export const categoriseSchema = z.object({
  categoryId: uuidSchema,
  via: z.enum(['FLUTTER', 'PUSH', 'WEB']),
  /** Remember this merchant: next time it is categorised on its own. */
  createRule: z.boolean().default(false),
});
export type CategoriseInput = z.infer<typeof categoriseSchema>;

export const parseTestSchema = z.object({
  body: z.string().min(1).max(1000),
  /** When given, the sender must also be on your allow-list. */
  sender: z.string().max(40).optional(),
});

export const pairingCodeSchema = z.object({
  code: z.string(),
  expiresAt: instantSchema,
  qrPayload: z.object({ apiUrl: z.string(), code: z.string() }),
});

export const pairRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6)
    .max(12)
    .transform((c) => c.toUpperCase()),
  deviceName: z.string().trim().min(1).max(60),
});

export const pairResultSchema = z.object({ deviceId: uuidSchema, deviceToken: z.string() });

export const deviceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: z.enum(['ANDROID_COMPANION', 'WEB']),
  lastSeenAt: instantSchema.nullable(),
  revokedAt: instantSchema.nullable(),
  createdAt: instantSchema,
});
export type DeviceDto = z.infer<typeof deviceSchema>;

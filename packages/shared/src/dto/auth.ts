import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userSettingsSchema = z.object({
  interestRounding: z.enum(['ROUND_HALF_UP_RUPEE', 'CARRY_PAISE']),
  storeRawSms: z.boolean(),
  smsSenderAllowList: z.array(z.string().min(1).max(40)).max(50),
  dedupeWindowMins: z.number().int().min(1).max(120),
  cashBufferPaise: z.number().int().min(0),
  forecastMonths: z.number().int().min(1).max(36),
});
export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

export const updateUserSettingsSchema = userSettingsSchema.partial();
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  timezone: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;

export const meResponseSchema = z.object({ user: userSchema, settings: userSettingsSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

export const authResponseSchema = z.object({ accessToken: z.string(), user: userSchema });
export type AuthResponse = z.infer<typeof authResponseSchema>;

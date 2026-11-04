import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    ALLOW_SIGNUP: bool.default('true'),
    COOKIE_SECURE: bool.optional(),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].startsWith('change-me') || env[key].startsWith('dev-')) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Replace the placeholder secret' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}

@Injectable()
export class AppConfig {
  readonly env: Env = parseEnv();

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** Refresh cookie `Secure` flag: explicit setting wins, otherwise on in production. */
  get cookieSecure(): boolean {
    return this.env.COOKIE_SECURE ?? this.isProduction;
  }
}

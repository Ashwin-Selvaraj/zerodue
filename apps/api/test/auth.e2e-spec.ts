import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

const credentials = { email: 'ashwin@example.com', password: 'correct-horse-battery' };

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('zd_refresh='));
  if (!cookie) throw new Error('No zd_refresh cookie in response');
  return cookie;
}

describe('ZeroDue auth + users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany(); // cascades to settings and refresh tokens
  });

  describe('health & docs', () => {
    it('serves /health without a token', async () => {
      const res = await http().get('/health').expect(200);
      expect(res.body).toEqual({ service: 'ZeroDue API', status: 'ok' });
    });

    it('serves an OpenAPI document that lists the auth routes', async () => {
      const res = await http().get('/docs/openapi.json').expect(200);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining(['/auth/register', '/auth/login', '/auth/refresh', '/me']),
      );
    });

    it('sets security headers', async () => {
      const res = await http().get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('register', () => {
    it('creates a user, returns an access token and sets an httpOnly refresh cookie', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ ...credentials, name: 'Ashwin' })
        .expect(201);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({
        email: credentials.email,
        name: 'Ashwin',
        timezone: 'Asia/Kolkata',
      });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      const cookie = refreshCookie(res);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/auth');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('stores the password as an argon2 hash and the refresh token only as a hash', async () => {
      const res = await http().post('/auth/register').send(credentials).expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      const rawToken = refreshCookie(res).split(';')[0]!.split('=')[1]!;
      const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.tokenHash).not.toBe(rawToken);
    });

    it('rejects a short password and a bad email with 400', async () => {
      await http()
        .post('/auth/register')
        .send({ email: credentials.email, password: 'short' })
        .expect(400);
      await http()
        .post('/auth/register')
        .send({ email: 'nope', password: credentials.password })
        .expect(400);
    });

    it('rejects a duplicate email, ignoring case, with 409', async () => {
      await http().post('/auth/register').send(credentials).expect(201);
      await http()
        .post('/auth/register')
        .send({ ...credentials, email: 'ASHWIN@Example.com' })
        .expect(409);
    });
  });

  describe('login and /me', () => {
    beforeEach(async () => {
      await http().post('/auth/register').send(credentials).expect(201);
    });

    it('logs in and returns the profile with default settings', async () => {
      const login = await http().post('/auth/login').send(credentials).expect(200);
      const me = await http()
        .get('/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(me.body.user.email).toBe(credentials.email);
      expect(me.body.settings).toEqual({
        interestRounding: 'ROUND_HALF_UP_RUPEE',
        storeRawSms: false,
        smsSenderAllowList: ['*-ICICIB', '*-ICICIT', '*-ICICIS'],
        dedupeWindowMins: 10,
        cashBufferPaise: 0,
        forecastMonths: 12,
      });
    });

    it('treats the email as case-insensitive on login', async () => {
      await http()
        .post('/auth/login')
        .send({ ...credentials, email: 'Ashwin@EXAMPLE.com' })
        .expect(200);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrong = await http()
        .post('/auth/login')
        .send({ ...credentials, password: 'wrong-password-123' });
      const unknown = await http()
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever-123456' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('requires a valid bearer token on /me', async () => {
      await http().get('/me').expect(401);
      await http().get('/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('updates settings and validates them', async () => {
      const { body } = await http().post('/auth/login').send(credentials).expect(200);
      const auth = { Authorization: `Bearer ${body.accessToken}` };
      const updated = await http()
        .patch('/me/settings')
        .set(auth)
        .send({ interestRounding: 'CARRY_PAISE', cashBufferPaise: 500_000 })
        .expect(200);
      expect(updated.body).toMatchObject({
        interestRounding: 'CARRY_PAISE',
        cashBufferPaise: 500_000,
      });
      await http().patch('/me/settings').set(auth).send({ dedupeWindowMins: 0 }).expect(400);
      await http().patch('/me/settings').set(auth).send({ cashBufferPaise: 10.5 }).expect(400);
    });
  });

  describe('refresh and logout', () => {
    it('rotates the refresh token and rejects the old one', async () => {
      const login = await http().post('/auth/register').send(credentials).expect(201);
      const first = refreshCookie(login).split(';')[0]!;

      const rotated = await http().post('/auth/refresh').set('Cookie', first).expect(200);
      expect(rotated.body.accessToken).toEqual(expect.any(String));
      const second = refreshCookie(rotated).split(';')[0]!;
      expect(second).not.toBe(first);

      await http().post('/auth/refresh').set('Cookie', first).expect(401);
      await http().post('/auth/refresh').set('Cookie', second).expect(200);
    });

    it('revokes every session when a long-rotated token is replayed', async () => {
      const login = await http().post('/auth/register').send(credentials).expect(201);
      const stolen = refreshCookie(login).split(';')[0]!;
      const rotated = await http().post('/auth/refresh').set('Cookie', stolen).expect(200);
      const live = refreshCookie(rotated).split(';')[0]!;

      // pretend the rotation happened a minute ago, outside the parallel-tab grace window
      await prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      await http().post('/auth/refresh').set('Cookie', stolen).expect(401);
      await http().post('/auth/refresh').set('Cookie', live).expect(401);
    });

    it('does not revoke the family when a parallel tab replays within the grace window', async () => {
      const login = await http().post('/auth/register').send(credentials).expect(201);
      const first = refreshCookie(login).split(';')[0]!;
      const rotated = await http().post('/auth/refresh').set('Cookie', first).expect(200);
      const live = refreshCookie(rotated).split(';')[0]!;

      await http().post('/auth/refresh').set('Cookie', first).expect(401);
      await http().post('/auth/refresh').set('Cookie', live).expect(200);
    });

    it('rejects a missing or forged refresh cookie', async () => {
      await http().post('/auth/refresh').expect(401);
      await http().post('/auth/refresh').set('Cookie', 'zd_refresh=forged').expect(401);
    });

    it('logout revokes the token and clears the cookie', async () => {
      const login = await http().post('/auth/register').send(credentials).expect(201);
      const cookie = refreshCookie(login).split(';')[0]!;

      const out = await http().post('/auth/logout').set('Cookie', cookie).expect(204);
      expect(refreshCookie(out)).toMatch(/zd_refresh=;/);
      await http().post('/auth/refresh').set('Cookie', cookie).expect(401);
    });
  });

  describe('sign-up switch', () => {
    it('returns 403 on register when ALLOW_SIGNUP=false, but login still works', async () => {
      await http().post('/auth/register').send(credentials).expect(201);

      process.env.ALLOW_SIGNUP = 'false';
      const closed = await createApp();
      try {
        await request(closed.getHttpServer())
          .post('/auth/register')
          .send({ email: 'other@example.com', password: credentials.password })
          .expect(403);
        await request(closed.getHttpServer()).post('/auth/login').send(credentials).expect(200);
      } finally {
        process.env.ALLOW_SIGNUP = 'true';
        await closed.close();
      }
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated login attempts', async () => {
      process.env.AUTH_RATE_LIMIT = '3';
      const limited = await createApp();
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          const res = await request(limited.getHttpServer())
            .post('/auth/login')
            .send({ email: 'x@example.com', password: 'whatever-123456' });
          statuses.push(res.status);
        }
        expect(statuses).toEqual([401, 401, 401, 429, 429]);
      } finally {
        process.env.AUTH_RATE_LIMIT = '1000';
        await limited.close();
      }
    });
  });
});

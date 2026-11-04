import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/common/clock';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

export const PASSWORD = 'correct-horse-battery';

/** Boots the real app. Pass a clock function to pin "now" (default: the real time). */
export async function createTestApp(now?: () => Date): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (now) builder.overrideProvider(Clock).useValue({ now });
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  // Transactions reference accounts without a cascade, so clear them first.
  const prisma = app.get(PrismaService);
  await prisma.transaction.deleteMany();
  await prisma.user.deleteMany();
}

export interface TestUser {
  id: string;
  email: string;
  auth: { Authorization: string };
}

export async function registerUser(
  app: INestApplication,
  email = 'ashwin@example.com',
): Promise<TestUser> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: PASSWORD })
    .expect(201);
  return { id: res.body.user.id, email, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

/** Looks up a seeded category or account id by name. */
export async function idByName(
  app: INestApplication,
  user: TestUser,
  path: '/categories' | '/accounts',
  name: string,
): Promise<string> {
  const res = await request(app.getHttpServer()).get(path).set(user.auth).expect(200);
  const found = (res.body as { id: string; name: string }[]).find((row) => row.name === name);
  if (!found) throw new Error(`${name} not found in ${path}`);
  return found.id;
}

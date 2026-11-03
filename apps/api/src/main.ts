import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { APP_NAME } from '@zerodue/shared';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`${APP_NAME} API listening on :${port}`);
}

void bootstrap();

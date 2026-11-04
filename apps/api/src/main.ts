import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// The monorepo keeps one .env at the root; a local apps/api/.env overrides it.
loadDotenv({ path: resolve(__dirname, '../.env') });
loadDotenv({ path: resolve(__dirname, '../../../.env') });

async function bootstrap() {
  // Imported after dotenv so AppConfig sees the variables.
  const { NestFactory } = await import('@nestjs/core');
  const { APP_NAME } = await import('@zerodue/shared');
  const { AppModule } = await import('./app.module');
  const { AppConfig } = await import('./config/app-config');
  const { configureApp } = await import('./setup-app');

  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(AppConfig).env.PORT;
  await app.listen(port);
  console.log(`${APP_NAME} API listening on :${port} (docs at /docs)`);
}

void bootstrap();

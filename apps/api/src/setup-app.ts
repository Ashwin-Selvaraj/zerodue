import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { APP_NAME, APP_TAGLINE } from '@zerodue/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { patchNestJsSwagger } from 'nestjs-zod';
import { AppConfig } from './config/app-config';

/** Shared by main.ts and the e2e tests so tests run the same middleware stack as production. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  if (config.env.TRUST_PROXY) {
    // one hop: the proxy in front of the API. Trusting more would let clients spoof their address.
    (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set(
      'trust proxy',
      1,
    );
  }
  app.use(helmet());
  app.use(cookieParser());
  // CORS is pinned to the PWA origin; credentials are needed for the httpOnly refresh cookie.
  app.enableCors({ origin: config.env.WEB_ORIGIN, credentials: true });

  patchNestJsSwagger();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(`${APP_NAME} API`)
      .setDescription(APP_TAGLINE)
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}

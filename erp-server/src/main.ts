import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  // bufferLogs so early boot logs go through pino once it's resolved.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route Nest's own logs through nestjs-pino (structured + requestId).
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  // Ensure the document upload directory exists before any multipart request
  // can hit the disk-storage handler (mkdir -p; idempotent).
  await mkdir(config.get('UPLOAD_DIR'), { recursive: true });

  // Parse cookies so the JWT strategy can read the httpOnly access_token cookie.
  app.use(cookieParser());

  const origins = config.corsOrigins;
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  const port = config.get('PORT');
  await app.listen(port);
}

void bootstrap();

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { origenesCors, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const env = {
    NODE_ENV: config.getOrThrow('NODE_ENV'),
    PORT: config.getOrThrow('PORT'),
    CORS_ORIGINS: config.getOrThrow('CORS_ORIGINS'),
  } as Env;

  app.use(helmet());
  app.enableCors({ origin: origenesCors(env), credentials: true });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Sin detalle de validación hacia afuera en producción (checklist §4.9)
      disableErrorMessages: env.NODE_ENV === 'production',
    }),
  );

  app.enableShutdownHooks();

  await app.listen(env.PORT);
  new Logger('bootstrap').log(`API Provivir escuchando en :${env.PORT} · ${env.NODE_ENV}`);
}

void bootstrap();

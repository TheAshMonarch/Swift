import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body for webhook signature verification
  });

  const frontendUrl = process.env.FRONTEND_URL;

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    // Fail closed: refuse to boot with credentials enabled and no origin configured.
    origin: frontendUrl ?? false,
    credentials: true, // needed for WebSocket handshake with auth token
  });

  if (!frontendUrl) {
    logger.warn('FRONTEND_URL is not set — CORS is closed to all browser origins.');
  }

  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 8080;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}

bootstrap();

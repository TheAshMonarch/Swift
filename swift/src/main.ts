import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body for webhook signature verification
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true, // needed for WebSocket handshake with auth token
  });

  app.useWebSocketAdapter(new IoAdapter(app)); // ← add this

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Artiz Backend Engine running live on route: http://localhost:${port}`);
}
bootstrap();
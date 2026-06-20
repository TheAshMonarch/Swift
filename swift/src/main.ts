import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Enforce strict incoming data validation checks globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,         // Strips out any extra form fields not declared in our DTOs
      forbidNonWhitelisted: true, // Throws an explicit error if a client sends unauthorized data
      transform: true,         // Automatically converts URL parameters into standard JS types
    }),
  );

  // Route all runtime code errors through filter layout
  app.useGlobalFilters(new HttpExceptionFilter());

  // Allow cross-origin communication for your mobile or web app frontend clients
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Swift Backend Engine running live on route: http://localhost:${port}`);
}
bootstrap();

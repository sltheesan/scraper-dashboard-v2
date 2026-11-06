import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';

process.env.TZ = process.env.TZ || 'Asia/Bangkok';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(bodyParser.json({ limit: '100mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });

  const config = new DocumentBuilder()
    .setTitle('Scraper Dashboard API')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();

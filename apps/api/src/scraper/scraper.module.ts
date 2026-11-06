import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ScraperService } from './scraper.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}

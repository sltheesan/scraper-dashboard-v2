import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScraperModule } from '../scraper/scraper.module';
import { SettingsModule } from '../settings/settings.module';
import { ScrapesController } from './scrapes.controller';
import { ScrapesService } from './scrapes.service';

@Module({
  imports: [PrismaModule, ScraperModule, SettingsModule],
  controllers: [ScrapesController],
  providers: [ScrapesService],
  exports: [ScrapesService],
})
export class ScrapesModule {}

import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ScraperModule } from '../scraper/scraper.module';
import { ScrapesModule } from '../scrapes/scrapes.module';
import { ActivityModule } from '../activity/activity.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [PrismaModule, ScraperModule, ScrapesModule, ActivityModule, LogsModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}

import { Module } from '@nestjs/common';
import { DailyCaptureService } from './daily-capture.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LogsModule } from '../logs/logs.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, LogsModule, SettingsModule],
  providers: [DailyCaptureService],
  exports: [DailyCaptureService],
})
export class DailyCaptureModule {}

import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [PrismaModule, LogsModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}

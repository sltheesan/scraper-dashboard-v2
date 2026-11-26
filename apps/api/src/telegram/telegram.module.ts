import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [ConfigModule, PrismaModule, LogsModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

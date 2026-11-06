import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SettingsModule } from './settings/settings.module';
import { ActivityModule } from './activity/activity.module';
import { UsersModule } from './users/users.module';
import { CredentialsModule } from './credentials/credentials.module';
import { LogsModule } from './logs/logs.module';
import { ScraperModule } from './scraper/scraper.module';
import { ScrapesModule } from './scrapes/scrapes.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { DailyCaptureModule } from './daily-capture/daily-capture.module';
import { TelegramModule } from './telegram/telegram.module';
import { BackupModule } from './backup/backup.module';
import { AppBootstrapService } from './app-bootstrap.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(__dirname, '..', '..', '..', '.env'), '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ProfilesModule,
    SettingsModule,
    ActivityModule,
    UsersModule,
    CredentialsModule,
    LogsModule,
    ScraperModule,
    ScrapesModule,
    SchedulerModule,
    DailyCaptureModule,
    TelegramModule,
    BackupModule,
  ],
  providers: [AppBootstrapService],
})
export class AppModule {}

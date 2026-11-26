import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { GmailOtpService } from './gmail-otp.service';
import { CredentialsController } from './credentials.controller';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, GmailOtpService],
  exports: [CredentialsService, GmailOtpService],
})
export class CredentialsModule {}

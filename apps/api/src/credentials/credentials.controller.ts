import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CredentialsService } from './credentials.service';
import { GmailOtpService } from './gmail-otp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrivilegesGuard, Privileges } from '../auth/privileges.guard';

@Controller('profiles/:profileId/credentials')
@UseGuards(JwtAuthGuard, PrivilegesGuard)
@ApiBearerAuth()
export class CredentialsController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly gmailOtp: GmailOtpService,
  ) {}

  @Get()
  @Privileges('credentials.view')
  getCredentials(@Param('profileId') profileId: string) {
    return this.credentials.getCredentials(profileId);
  }

  @Put()
  @Privileges('credentials.edit')
  setCredentials(
    @Param('profileId') profileId: string,
    @Body() body: { username: string; password: string; pin?: string; otpEmail?: string; totpSecret?: string },
  ) {
    return this.credentials.setCredentials(profileId, body);
  }

  @Delete()
  @Privileges('credentials.edit')
  deleteCredentials(@Param('profileId') profileId: string) {
    return this.credentials.deleteCredentials(profileId);
  }

  @Post('totp')
  @Privileges('credentials.view')
  async getTotp(@Param('profileId') profileId: string) {
    try {
      const result = await this.credentials.generateTotp(profileId);
      return { configured: true, ...result };
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Failed to generate TOTP code');
    }
  }

  @Post('otp')
  @Privileges('credentials.view')
  async getOtp(@Param('profileId') profileId: string) {
    if (!this.gmailOtp.isConfigured()) {
      throw new BadRequestException(
        'Gmail OTP is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env',
      );
    }

    let cred: any;
    try {
      cred = await this.credentials.getCredentials(profileId);
    } catch {
      throw new BadRequestException(
        'No credentials found for this profile. Edit the profile and set the OTP Email first.',
      );
    }

    if (!cred.otpEmail) {
      throw new BadRequestException(
        'No OTP email configured for this profile. Edit the profile and set the OTP Email field.',
      );
    }

    const result = await this.gmailOtp.fetchLatestOtp(cred.otpEmail);
    return {
      configured: true,
      otpEmail: cred.otpEmail,
      result,
    };
  }
}

import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CredentialsService } from './credentials.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('profiles/:profileId/credentials')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  @Roles('ADMIN', 'OPERATOR')
  getCredentials(@Param('profileId') profileId: string) {
    return this.credentials.getCredentials(profileId);
  }

  @Put()
  @Roles('ADMIN', 'OPERATOR')
  setCredentials(
    @Param('profileId') profileId: string,
    @Body() body: { username: string; password: string; pin?: string; otpEmail?: string },
  ) {
    return this.credentials.setCredentials(profileId, body);
  }

  @Delete()
  @Roles('ADMIN')
  deleteCredentials(@Param('profileId') profileId: string) {
    return this.credentials.deleteCredentials(profileId);
  }
}

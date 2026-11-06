import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  @Roles('ADMIN')
  exportBackup() {
    return this.backup.exportAll();
  }

  @Post('restore')
  @Roles('ADMIN')
  async restoreBackup(@Body() body: any) {
    return this.backup.restoreAll(body);
  }
}

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
import { PrivilegesGuard, Privileges } from '../auth/privileges.guard';

@Controller('backup')
@UseGuards(JwtAuthGuard, PrivilegesGuard)
@ApiBearerAuth()
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  @Privileges('backup.export')
  exportBackup() {
    return this.backup.exportAll();
  }

  @Post('restore')
  @Privileges('backup.restore')
  async restoreBackup(@Body() body: any) {
    return this.backup.restoreAll(body);
  }
}

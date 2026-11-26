import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserGroupsService } from './user-groups.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrivilegesGuard, Privileges } from '../auth/privileges.guard';
import { ALL_PRIVILEGES, PRIVILEGE_CATEGORIES } from '../common/privileges';

@Controller('user-groups')
@UseGuards(JwtAuthGuard, PrivilegesGuard)
@ApiBearerAuth()
export class UserGroupsController {
  constructor(private readonly groups: UserGroupsService) {}

  @Get()
  @Privileges('groups.manage')
  findAll() {
    return this.groups.findAll();
  }

  @Get('privileges')
  @Privileges('groups.manage')
  getPrivileges() {
    return { privileges: ALL_PRIVILEGES, categories: PRIVILEGE_CATEGORIES };
  }

  @Get(':id')
  @Privileges('groups.manage')
  findOne(@Param('id') id: string) {
    return this.groups.findOne(id);
  }

  @Post()
  @Privileges('groups.manage')
  create(@Body() body: { name: string; description?: string; privileges?: string[] }) {
    return this.groups.create(body);
  }

  @Patch(':id')
  @Privileges('groups.manage')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; privileges?: string[] }) {
    return this.groups.update(id, body);
  }

  @Delete(':id')
  @Privileges('groups.manage')
  remove(@Param('id') id: string) {
    return this.groups.remove(id);
  }
}

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
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrivilegesGuard, Privileges } from '../auth/privileges.guard';

@Controller('users')
@UseGuards(JwtAuthGuard, PrivilegesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @Privileges('users.view')
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  @Privileges('users.view')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  @Privileges('users.create')
  create(@Body() body: { email: string; password: string; name: string; groupId?: string }) {
    return this.auth.register(body.email, body.password, body.name, body.groupId);
  }

  @Patch(':id/group')
  @Privileges('users.edit')
  updateGroup(@Param('id') id: string, @Body() body: { groupId: string | null }) {
    return this.users.updateGroup(id, body.groupId);
  }

  @Patch(':id/deactivate')
  @Privileges('users.edit')
  deactivate(@Param('id') id: string) {
    return this.users.deactivate(id);
  }

  @Patch(':id/activate')
  @Privileges('users.edit')
  activate(@Param('id') id: string) {
    return this.users.activate(id);
  }

  @Delete(':id')
  @Privileges('users.delete')
  deleteUser(@Param('id') id: string) {
    return this.users.deleteUser(id);
  }
}

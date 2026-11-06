import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './users.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id/role')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.users.updateRole(id, dto.role as any);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.users.deactivate(id);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.users.activate(id);
  }

  @Delete(':id')
  deleteUser(@Param('id') id: string) {
    return this.users.deleteUser(id);
  }
}

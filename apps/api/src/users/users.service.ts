import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SUPER_ADMIN_EMAIL } from '../common/privileges';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  isSuperAdmin: true,
  groupId: true,
  group: { select: { id: true, name: true } },
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateGroup(id: string, groupId: string | null) {
    await this.ensureExists(id);
    return this.prisma.user.update({
      where: { id },
      data: { groupId },
      select: USER_SELECT,
    });
  }

  async deactivate(id: string) {
    await this.ensureMutable(id);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SELECT,
    });
  }

  async activate(id: string) {
    await this.ensureExists(id);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: USER_SELECT,
    });
  }

  async deleteUser(id: string) {
    await this.ensureMutable(id);
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }

  private async ensureExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async ensureMutable(id: string) {
    const user = await this.ensureExists(id);
    if (user.isSuperAdmin) {
      throw new ForbiddenException('Super admin account cannot be modified');
    }
    return user;
  }
}

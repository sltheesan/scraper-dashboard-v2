import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@scraper/database';
import { PrismaService } from '../prisma/prisma.service';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
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

  async updateRole(id: string, role: UserRole) {
    await this.ensureExists(id);
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: USER_SELECT,
    });
  }

  async deactivate(id: string) {
    await this.ensureExists(id);
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
    await this.ensureExists(id);
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }

  private async ensureExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
  }
}

import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_PRIVILEGES } from '../common/privileges';

@Injectable()
export class UserGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async findOne(id: string) {
    const group = await this.prisma.userGroup.findUnique({
      where: { id },
      include: { users: { select: { id: true, email: true, name: true } } },
    });
    if (!group) throw new NotFoundException('User group not found');
    return group;
  }

  async create(data: { name: string; description?: string; privileges?: string[] }) {
    this.validatePrivileges(data.privileges);
    try {
      return await this.prisma.userGroup.create({
        data: {
          name: data.name,
          description: data.description || '',
          privileges: data.privileges || [],
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('Group name already exists');
      throw err;
    }
  }

  async update(id: string, data: { name?: string; description?: string; privileges?: string[] }) {
    await this.ensureExists(id);
    this.validatePrivileges(data.privileges);
    try {
      return await this.prisma.userGroup.update({
        where: { id },
        data,
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('Group name already exists');
      throw err;
    }
  }

  async remove(id: string) {
    const group = await this.prisma.userGroup.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!group) throw new NotFoundException('User group not found');
    if (group._count.users > 0) {
      throw new BadRequestException(
        `Cannot delete group "${group.name}" — it still has ${group._count.users} user(s) assigned`,
      );
    }
    await this.prisma.userGroup.delete({ where: { id } });
    return { deleted: true };
  }

  private validatePrivileges(privileges?: string[]) {
    if (!privileges) return;
    const invalid = privileges.filter((p) => !(ALL_PRIVILEGES as readonly string[]).includes(p));
    if (invalid.length) {
      throw new BadRequestException(`Unknown privileges: ${invalid.join(', ')}`);
    }
  }

  private async ensureExists(id: string) {
    const group = await this.prisma.userGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('User group not found');
  }
}

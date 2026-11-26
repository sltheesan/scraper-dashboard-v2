import { Injectable } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileKind, ProfileStatus } from '@scraper/database';

const PROFILES_ROOT = 'profiles';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.profile.findMany({
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.profile.findUniqueOrThrow({
      where: { id },
      include: { credential: true },
    });
  }

  create(data: {
    name: string;
    kind: ProfileKind;
    loginUrl: string;
    targetUrl: string;
    buttonSelector?: string;
    dataFields?: any;
    proxy?: string;
    notes?: string;
    refreshIntervalMs?: number;
  }) {
    return this.prisma.profile.create({
      data: {
        ...data,
        userDataDir: join(PROFILES_ROOT, data.name),
      },
    });
  }

  update(
    id: string,
    data: Partial<{
      name: string;
      loginUrl: string;
      targetUrl: string;
      buttonSelector: string;
      status: ProfileStatus;
      dataFields: any;
      proxy: string;
      notes: string;
      refreshIntervalMs: number;
      lastLoginAt: Date;
      lastScrapeAt: Date;
    }>,
  ) {
    const updates: any = { ...data };
    if (updates.name) {
      updates.userDataDir = join(PROFILES_ROOT, updates.name);
    }
    return this.prisma.profile.update({ where: { id }, data: updates });
  }

  remove(id: string) {
    return this.prisma.profile.delete({ where: { id } });
  }
}

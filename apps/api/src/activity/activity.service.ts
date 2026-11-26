import { Injectable } from '@nestjs/common';
import { ActorType } from '@scraper/database';
import { PrismaService } from '../prisma/prisma.service';

interface RecordActivityData {
  actorType: ActorType;
  actorId?: string;
  action: string;
  target?: string;
  details?: string;
  meta?: any;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  recordActivity(data: RecordActivityData) {
    this.prisma.activityLog
      .create({
        data: {
          actorType: data.actorType,
          actorId: data.actorId,
          action: data.action,
          target: data.target || '',
          details: data.details || '',
          meta: data.meta ?? undefined,
        },
      })
      .catch(() => {});
  }

  async getActivity(params: {
    page?: number;
    limit?: number;
    actorType?: ActorType;
    action?: string;
    search?: string;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.actorType) where.actorType = params.actorType;
    if (params.action) where.action = params.action;
    if (params.search) {
      const q = params.search;
      where.OR = [
        { action: { contains: q, mode: 'insensitive' } },
        { target: { contains: q, mode: 'insensitive' } },
        { details: { contains: q, mode: 'insensitive' } },
        { actor: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getDistinctActions(): Promise<string[]> {
    const rows = await this.prisma.activityLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}

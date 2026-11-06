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
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const where = params.actorType ? { actorType: params.actorType } : {};

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
}

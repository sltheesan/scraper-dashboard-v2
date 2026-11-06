import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ActorType } from '@scraper/database';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Controller('activity')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  getActivity(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('actorType') actorType?: ActorType,
  ) {
    return this.activity.getActivity({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      actorType,
    });
  }
}

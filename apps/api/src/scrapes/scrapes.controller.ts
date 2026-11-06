import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ScrapesService } from './scrapes.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('scrapes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ScrapesController {
  constructor(
    private readonly scrapes: ScrapesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  findAll(
    @Query('profileId') profileId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    if (profileId && from && to) {
      return this.scrapes.getByDateRange(
        profileId,
        new Date(from),
        new Date(to),
      );
    }
    if (profileId) {
      return this.scrapes.getLatest(profileId, limit ? parseInt(limit) : 30);
    }
    return this.scrapes.getAllToday();
  }

  @Get('profile/:profileId')
  getByProfile(
    @Param('profileId') profileId: string,
    @Query('limit') limit?: string,
  ) {
    return this.scrapes.getLatest(profileId, limit ? parseInt(limit) : 30);
  }

  @Get('today/:profileId')
  getToday(@Param('profileId') profileId: string) {
    return this.scrapes.getToday(profileId);
  }

  @Get('yesterday/:profileId')
  getYesterday(@Param('profileId') profileId: string) {
    return this.scrapes.getYesterday(profileId);
  }

  @Post('fetch/:profileId')
  @Roles('ADMIN', 'OPERATOR')
  async fetch(
    @Param('profileId') profileId: string,
    @Body() body: { period?: 'today' | 'yesterday' },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const period = body.period || 'today';

    if (period === 'yesterday') {
      return this.scrapes.fetchYesterday(profile);
    }

    return this.scrapes.runAndSave(profile, period);
  }
}

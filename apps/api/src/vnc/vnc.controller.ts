import { Controller, Post, Get, Req, Res, Headers, UseGuards, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const TOKEN_TTL = 5 * 60 * 1000;
const tokens = new Map<string, number>();

interface VncSession {
  userId: string;
  userName: string;
  profileName: string;
  startedAt: number;
  token: string;
}

let activeSession: VncSession | null = null;

function cleanup() {
  const now = Date.now();
  for (const [t, exp] of tokens) {
    if (exp < now) tokens.delete(t);
  }
  if (activeSession && !tokens.has(activeSession.token)) {
    activeSession = null;
  }
}

@Controller('vnc')
export class VncController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('token')
  @UseGuards(JwtAuthGuard)
  async createToken(@Req() req: any) {
    cleanup();

    if (activeSession && tokens.has(activeSession.token) && activeSession.userId !== req.user?.sub) {
      throw new ForbiddenException(
        `VNC is in use by ${activeSession.userName} (profile: ${activeSession.profileName}). Ask them to finish, or end the session from the dashboard.`,
      );
    }

    const token = randomUUID();
    tokens.set(token, Date.now() + TOKEN_TTL);

    const dbUser = await this.prisma.user.findUnique({ where: { id: req.user?.sub }, select: { name: true } }).catch(() => null);

    activeSession = {
      userId: req.user?.sub || '',
      userName: dbUser?.name || req.user?.email || 'Unknown',
      profileName: req.body?.profileName || '',
      startedAt: Date.now(),
      token,
    };

    return { token };
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  getSession(@Req() req: any) {
    cleanup();
    if (!activeSession) return { active: false };
    return {
      active: true,
      userName: activeSession.userName,
      profileName: activeSession.profileName,
      startedAt: new Date(activeSession.startedAt).toISOString(),
      isOwner: activeSession.userId === req.user?.sub,
    };
  }

  @Post('end-session')
  @UseGuards(JwtAuthGuard)
  endSession() {
    cleanup();
    if (activeSession) {
      tokens.delete(activeSession.token);
      activeSession = null;
    }
    return { ok: true };
  }

  @Get('auth')
  validateToken(
    @Headers('x-forwarded-uri') uri: string,
    @Res() res: Response,
  ) {
    cleanup();
    try {
      const url = new URL(uri, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token && tokens.has(token) && tokens.get(token)! > Date.now()) {
        return res.status(200).send('OK');
      }
    } catch {}
    return res.status(401).send('Unauthorized');
  }
}

import { Controller, Post, Get, Res, Headers, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const TOKEN_TTL = 5 * 60 * 1000;
const tokens = new Map<string, number>();

function cleanup() {
  const now = Date.now();
  for (const [t, exp] of tokens) {
    if (exp < now) tokens.delete(t);
  }
}

@Controller('api/vnc')
export class VncController {
  @Post('token')
  @UseGuards(JwtAuthGuard)
  createToken() {
    cleanup();
    const token = randomUUID();
    tokens.set(token, Date.now() + TOKEN_TTL);
    return { token };
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

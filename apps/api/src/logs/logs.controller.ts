import { Controller, Get, Sse, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { LogsService } from './logs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller('logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get('recent')
  getRecent(@Query('limit') limit?: string) {
    return this.logs.getRecent(limit ? parseInt(limit, 10) : 50);
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const unsub = this.logs.subscribe((event) => {
        subscriber.next({ data: JSON.stringify(event) });
      });
      return () => unsub();
    });
  }
}

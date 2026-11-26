import { Injectable } from '@nestjs/common';

export interface LogEvent {
  id: number;
  type: string;
  level?: string;
  profileId?: string;
  message: string;
  data?: any;
  timestamp: Date;
}

type Subscriber = (event: LogEvent) => void;

@Injectable()
export class LogsService {
  private buffer: LogEvent[] = [];
  private maxSize = 200;
  private nextId = 1;
  private subscribers = new Set<Subscriber>();

  logEvent(event: Omit<LogEvent, 'id' | 'timestamp'> & { timestamp?: Date }) {
    const entry: LogEvent = {
      ...event,
      id: this.nextId++,
      timestamp: event.timestamp ?? new Date(),
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch {}
    }
  }

  getRecent(limit = 50): LogEvent[] {
    return this.buffer.slice(-limit);
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}

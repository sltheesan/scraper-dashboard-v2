import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';

const BACKUP_VERSION = 2;
const SNAPSHOTS_DIR = 'backups';

export interface BackupData {
  version: number;
  timestamp: string;
  collections: {
    users?: any[];
    profiles?: any[];
    profileCredentials?: any[];
    scrapes?: any[];
    settings?: any[];
    activityLogs?: any[];
    backupImports?: any[];
    legacyDocuments?: any[];
  };
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private schedulerService: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
  ) {}

  setSchedulerService(service: any) { this.schedulerService = service; }

  async exportAll(): Promise<BackupData> {
    const [users, profiles, profileCredentials, scrapes, settings, activityLogs, backupImports, legacyDocuments] =
      await Promise.all([
        this.prisma.user.findMany(),
        this.prisma.profile.findMany(),
        this.prisma.profileCredential.findMany(),
        this.prisma.scrape.findMany(),
        this.prisma.setting.findMany(),
        this.prisma.activityLog.findMany(),
        this.prisma.backupImport.findMany(),
        this.prisma.legacyDocument.findMany(),
      ]);

    this.logs.logEvent({ type: 'backup', message: 'Backup exported' });

    return {
      version: BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      collections: {
        users,
        profiles,
        profileCredentials,
        scrapes,
        settings,
        activityLogs,
        backupImports,
        legacyDocuments,
      },
    };
  }

  validateBackup(data: any): data is BackupData {
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('Invalid backup: not an object');
    }
    if (!data.version || data.version > BACKUP_VERSION) {
      throw new BadRequestException(
        `Invalid backup version: ${data.version} (expected <= ${BACKUP_VERSION})`,
      );
    }
    if (!data.collections || typeof data.collections !== 'object') {
      throw new BadRequestException('Invalid backup: missing collections');
    }

    const required = ['users', 'profiles', 'settings'];
    for (const key of required) {
      const arr = data.collections[key];
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new BadRequestException(
          `Restore refused: collection "${key}" is empty or missing. ` +
            `This safety check prevents accidental data wipe.`,
        );
      }
    }

    return true;
  }

  private async savePreRestoreSnapshot(): Promise<string> {
    const snapshot = await this.exportAll();
    await mkdir(SNAPSHOTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(SNAPSHOTS_DIR, `pre-restore-${ts}.json`);
    await writeFile(path, JSON.stringify(snapshot, null, 2));
    this.logger.log(`Pre-restore snapshot saved to ${path}`);
    return path;
  }

  async restoreAll(data: any) {
    this.validateBackup(data);

    const snapshotPath = await this.savePreRestoreSnapshot();
    this.logs.logEvent({
      type: 'backup',
      message: `Pre-restore snapshot saved: ${snapshotPath}`,
    });

    const c = data.collections;
    const restored: Record<string, number> = {};
    const skipped: string[] = [];

    const deleteOrder = [
      'legacyDocument',
      'backupImport',
      'activityLog',
      'scrape',
      'profileCredential',
      'profile',
      'setting',
      'user',
    ] as const;

    const insertOrder = [
      { key: 'users', model: 'user' as const },
      { key: 'settings', model: 'setting' as const },
      { key: 'profiles', model: 'profile' as const },
      { key: 'profileCredentials', model: 'profileCredential' as const },
      { key: 'scrapes', model: 'scrape' as const },
      { key: 'activityLogs', model: 'activityLog' as const },
      { key: 'backupImports', model: 'backupImport' as const },
      { key: 'legacyDocuments', model: 'legacyDocument' as const },
    ];

    await this.prisma.$transaction(async (tx) => {
      for (const model of deleteOrder) {
        await (tx[model] as any).deleteMany();
      }

      for (const { key, model } of insertOrder) {
        const arr = c[key];
        if (!Array.isArray(arr) || arr.length === 0) {
          skipped.push(key);
          continue;
        }
        await (tx[model] as any).createMany({ data: arr });
        restored[key] = arr.length;
      }
    });

    this.logger.log('Backup restored successfully');
    this.logs.logEvent({
      type: 'backup',
      message: 'Backup restored',
      data: { restored, skipped, snapshotPath },
    });

    if (this.schedulerService) {
      try {
        await this.schedulerService.loadSettings();
        await this.schedulerService.rescheduleAll();
        this.logger.log('Scheduler re-armed after restore');
      } catch (err: any) {
        this.logger.warn(`Scheduler re-arm failed: ${err.message}`);
      }
    }

    return { ok: true, restored, skipped, snapshot: snapshotPath };
  }
}

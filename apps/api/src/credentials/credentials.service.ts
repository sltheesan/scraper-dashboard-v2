import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CredentialsService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const keyHex = this.config.get<string>('ENCRYPTION_KEY', '');
    this.key = keyHex.length === 64
      ? Buffer.from(keyHex, 'hex')
      : Buffer.alloc(32, keyHex || 'default-dev-key');
  }

  encrypt(text: string): string {
    if (!text) return '';
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(encrypted: string): string {
    if (!encrypted || !encrypted.includes(':')) return '';
    const [ivHex, dataHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  async setCredentials(
    profileId: string,
    data: { username: string; password: string; pin?: string; otpEmail?: string },
  ) {
    const encrypted = {
      usernameEncrypted: this.encrypt(data.username),
      passwordEncrypted: this.encrypt(data.password),
      pinEncrypted: this.encrypt(data.pin || ''),
      otpEmail: data.otpEmail || '',
    };

    return this.prisma.profileCredential.upsert({
      where: { profileId },
      update: encrypted,
      create: { profileId, ...encrypted },
    });
  }

  async getCredentials(profileId: string) {
    const cred = await this.prisma.profileCredential.findUnique({
      where: { profileId },
    });
    if (!cred) throw new NotFoundException('No credentials found for this profile');

    return {
      profileId: cred.profileId,
      username: this.decrypt(cred.usernameEncrypted),
      password: this.decrypt(cred.passwordEncrypted),
      pin: this.decrypt(cred.pinEncrypted),
      otpEmail: cred.otpEmail,
    };
  }

  async deleteCredentials(profileId: string) {
    await this.prisma.profileCredential.delete({ where: { profileId } });
    return { deleted: true };
  }
}

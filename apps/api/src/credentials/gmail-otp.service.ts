import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OtpResult {
  otp: string | null;
  subject: string;
  from: string;
  receivedAt: string;
}

@Injectable()
export class GmailOtpService {
  private readonly logger = new Logger(GmailOtpService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get('GMAIL_CLIENT_ID', '');
    this.clientSecret = this.config.get('GMAIL_CLIENT_SECRET', '');
    this.refreshToken = this.config.get('GMAIL_REFRESH_TOKEN', '');
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail token refresh failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken!;
  }

  async fetchLatestOtp(otpEmail: string): Promise<OtpResult | null> {
    const token = await this.getAccessToken();

    const query = `{to:${otpEmail} deliveredto:${otpEmail} ${otpEmail}} newer_than:10m`;
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!listRes.ok) {
      throw new Error(`Gmail list failed: ${listRes.status}`);
    }

    const listData = await listRes.json();
    if (!listData.messages?.length) return null;

    for (const msg of listData.messages) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!msgRes.ok) continue;
      const msgData = await msgRes.json();

      const headers = msgData.payload?.headers || [];
      const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '';
      const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
      const dateStr = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';

      const body = this.extractBody(msgData.payload);
      const otp = this.extractOtpCode(subject + ' ' + body);

      if (otp) {
        return { otp, subject, from, receivedAt: dateStr };
      }
    }

    return null;
  }

  private extractBody(payload: any): string {
    if (!payload) return '';

    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf8');
        }
      }
      for (const part of payload.parts) {
        const nested = this.extractBody(part);
        if (nested) return nested;
      }
    }

    return '';
  }

  private extractOtpCode(text: string): string | null {
    const patterns = [
      /\b(\d{6})\b/,
      /\b(\d{4})\b/,
      /code[:\s]*(\d{4,8})/i,
      /otp[:\s]*(\d{4,8})/i,
      /verification[:\s]*(\d{4,8})/i,
      /pin[:\s]*(\d{4,8})/i,
    ];

    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) return m[1];
    }

    return null;
  }
}

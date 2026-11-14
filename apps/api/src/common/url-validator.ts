import { BadRequestException } from '@nestjs/common';
import { URL } from 'url';

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
];

const PRIVATE_RANGES = [
  { start: 0x0a000000, end: 0x0affffff },   // 10.0.0.0/8
  { start: 0xac100000, end: 0xac1fffff },   // 172.16.0.0/12
  { start: 0xc0a80000, end: 0xc0a8ffff },   // 192.168.0.0/16
  { start: 0xa9fe0000, end: 0xa9feffff },   // 169.254.0.0/16 (link-local / cloud metadata)
  { start: 0x7f000000, end: 0x7fffffff },   // 127.0.0.0/8
];

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  return PRIVATE_RANGES.some((r) => n >= r.start && n <= r.end);
}

export function validateProfileUrl(url: string, fieldName: string): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException(`${fieldName} is not a valid URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException(`${fieldName} must use http or https`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTS.includes(hostname)) {
    throw new BadRequestException(`${fieldName} must not point to a local or internal address`);
  }

  if (isPrivateIp(hostname)) {
    throw new BadRequestException(`${fieldName} must not point to a private IP range`);
  }
}

export function validateProxyUrl(url: string): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('proxy is not a valid URL');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new BadRequestException('proxy must not point to a cloud metadata endpoint');
  }
}

export const DEFAULT_CUTOVER = '11:00';
const CUTOVER_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TZ = 'Asia/Bangkok';

export function isValidCutover(s: string): boolean {
  return CUTOVER_RE.test(String(s ?? '').trim());
}

export function parseCutover(cutover: string): { h: number; m: number } {
  const match = CUTOVER_RE.exec(String(cutover ?? '').trim());
  if (!match) return { h: 11, m: 0 };
  return { h: Number(match[1]), m: Number(match[2]) };
}

function bangkokParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

export function businessDayDate(
  now: Date = new Date(),
  cutover: string = DEFAULT_CUTOVER,
): Date {
  const bp = bangkokParts(now);
  const { h, m } = parseCutover(cutover);
  const cutoverMinutes = h * 60 + m;
  const nowMinutes = bp.hour * 60 + bp.minute;

  let d = new Date(Date.UTC(bp.year, bp.month - 1, bp.day));
  if (nowMinutes < cutoverMinutes) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}

export function yesterdayBusinessDate(
  now: Date = new Date(),
  cutover: string = DEFAULT_CUTOVER,
): Date {
  const d = businessDayDate(now, cutover);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export function msUntilCutover(
  now: Date = new Date(),
  cutover: string = DEFAULT_CUTOVER,
  offsetMin: number = 0,
): number {
  const bp = bangkokParts(now);
  const { h, m } = parseCutover(cutover);

  const nowMs = bp.hour * 3600_000 + bp.minute * 60_000;
  let targetMs = (h * 60 + m + offsetMin) * 60_000;
  if (targetMs <= nowMs) targetMs += 24 * 3600_000;
  return Math.max(targetMs - nowMs, 60_000);
}

export function formatICT(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date) + ' ICT';
}

export function formatICTDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date) + ' ICT';
}

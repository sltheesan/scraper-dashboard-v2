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

function nowInICT(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

export function businessDayDate(
  now: Date = new Date(),
  cutover: string = DEFAULT_CUTOVER,
): Date {
  const ict = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const { h, m } = parseCutover(cutover);
  const cutoverMinutes = h * 60 + m;
  const nowMinutes = ict.getHours() * 60 + ict.getMinutes();

  const d = new Date(ict);
  d.setHours(0, 0, 0, 0);
  if (nowMinutes < cutoverMinutes) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

export function yesterdayBusinessDate(
  now: Date = new Date(),
  cutover: string = DEFAULT_CUTOVER,
): Date {
  const d = businessDayDate(now, cutover);
  d.setDate(d.getDate() - 1);
  return d;
}

export function msUntilCutover(
  now: Date = new Date(),
  cutover: string = DEFAULT_CUTOVER,
  offsetMin: number = 0,
): number {
  const ict = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const { h, m } = parseCutover(cutover);

  const next = new Date(ict);
  next.setHours(h, m + offsetMin, 0, 0);
  if (next.getTime() <= ict.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(next.getTime() - ict.getTime(), 60_000);
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

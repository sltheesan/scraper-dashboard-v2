import { businessDayDate, yesterdayBusinessDate, DEFAULT_CUTOVER } from '../../common/business-day';

export const COMMON_FIELDS = [
  'newRegistrationCount',
  'newDepositCount',
  'totalDepositCount',
  'totalDepositAmount',
  'totalWithdrawalCount',
  'totalWithdrawalAmount',
] as const;

export const COMMON_LABELS: Record<string, string> = {
  newRegistrationCount: 'New Registration Count',
  newDepositCount: 'New Deposit Count',
  totalDepositCount: 'Total Deposit Count',
  totalDepositAmount: 'Total Deposit Amount',
  totalWithdrawalCount: 'Total Withdrawal Count',
  totalWithdrawalAmount: 'Total Withdrawal Amount',
};

export interface ScrapedData {
  newRegistrationCount: number | null;
  newDepositCount: number | null;
  totalDepositCount: number | null;
  totalDepositAmount: number | null;
  totalWithdrawalCount: number | null;
  totalWithdrawalAmount: number | null;
}

export interface ParseResult {
  data: ScrapedData;
  reportDate: Date;
  reportDateString: string;
  raw?: any;
  fallback?: boolean;
  kind?: string;
}

export interface TableInfo {
  id?: string;
  className?: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  frameUrl?: string;
}

export interface FetchResult {
  loggedIn: boolean;
  accessDenied?: boolean;
  parsed?: ParseResult;
  error?: string;
  message?: string;
  url?: string;
  title?: string;
  frameCount?: number;
  tables?: TableInfo[];
  fields?: Record<string, string | null>;
  kind?: string;
  cached?: boolean;
  scrape?: any;
}

export function todayReportDate(cutover: string = DEFAULT_CUTOVER): Date {
  return businessDayDate(new Date(), cutover);
}

export function yesterdayReportDate(cutover: string = DEFAULT_CUTOVER): Date {
  return yesterdayBusinessDate(new Date(), cutover);
}

export function reportDateFor(period: 'today' | 'yesterday', cutover: string = DEFAULT_CUTOVER): Date {
  return period === 'yesterday' ? yesterdayReportDate(cutover) : todayReportDate(cutover);
}

export function formatDateString(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === 'N/A') return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

export function emptyData(): ScrapedData {
  return {
    newRegistrationCount: null,
    newDepositCount: null,
    totalDepositCount: null,
    totalDepositAmount: null,
    totalWithdrawalCount: null,
    totalWithdrawalAmount: null,
  };
}

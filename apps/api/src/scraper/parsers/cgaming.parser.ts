import {
  ParseResult,
  TableInfo,
  emptyData,
  parseNumber,
} from './common';
import { businessDayDate, DEFAULT_CUTOVER } from '../../common/business-day';

function parseStartDate(s: string): Date | null {
  if (typeof s !== 'string') return null;
  const start = s.split(/\s+-\s+/)[0];
  const m = start?.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh = '0', mi = '0', ss = '0'] = m;
  return new Date(
    Number(yyyy), Number(mm) - 1, Number(dd),
    Number(hh), Number(mi), Number(ss),
  );
}

export function findBankSummaryTable(tables: TableInfo[]): TableInfo | null {
  return tables.find((t) =>
    String(t.className || '').split(/\s+/).includes('bank-summary'),
  ) ?? null;
}

function headerIndex(headers: string[], name: string): number {
  const target = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return headers.findIndex(
    (h) => String(h).toLowerCase().replace(/\s+/g, ' ').trim() === target,
  );
}

export interface CgamingParseOptions {
  targetDate: Date;
  cutover?: string;
  allowFallback?: boolean;
}

export function parseBankSummary(
  table: TableInfo,
  opts: CgamingParseOptions,
): ParseResult | null {
  const { targetDate, cutover = DEFAULT_CUTOVER, allowFallback = false } = opts;

  if (!table.headers?.length || !table.rows?.length) return null;
  if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) return null;

  const idx = {
    reportDate: headerIndex(table.headers, 'Report Date'),
    newRegister: headerIndex(table.headers, 'New Register Account / Deposit'),
    totalDeposit: headerIndex(table.headers, 'Total Deposit'),
    totalWithdrawal: headerIndex(table.headers, 'Total Withdrawal'),
    totalTrxDeposit: headerIndex(table.headers, 'Total TRX Deposit'),
    totalTrxWithdrawal: headerIndex(table.headers, 'Total TRX Withdrawal'),
  };

  if (idx.reportDate < 0) return null;

  const targetMs = targetDate.getTime();
  let exact: { row: string[]; dateStr: string; bday: Date } | null = null;
  let fallbackRow: { row: string[]; dateStr: string; bday: Date } | null = null;

  for (const row of table.rows) {
    const dateStr = row[idx.reportDate];
    const start = parseStartDate(dateStr);
    if (!start) continue;
    const bday = businessDayDate(start, cutover);
    const bms = bday.getTime();

    if (bms === targetMs) {
      exact = { row, dateStr, bday };
      break;
    }
    if (allowFallback && bms < targetMs) {
      if (!fallbackRow || bms > fallbackRow.bday.getTime()) {
        fallbackRow = { row, dateStr, bday };
      }
    }
  }

  const hit = exact || (allowFallback ? fallbackRow : null);
  if (!hit) return null;

  const { row, dateStr, bday } = hit;
  const newRegRaw = String(row[idx.newRegister] ?? '');
  const [newRegAcct, newRegDep] = newRegRaw.split('/').map((s) => s.trim());

  const raw: Record<string, string | null> = {};
  for (let i = 0; i < table.headers.length; i++) {
    raw[table.headers[i]] = row[i] ?? null;
  }

  return {
    reportDate: bday,
    reportDateString: dateStr,
    data: {
      newRegistrationCount: parseNumber(newRegAcct),
      newDepositCount: parseNumber(newRegDep),
      totalDepositCount: parseNumber(row[idx.totalTrxDeposit]),
      totalDepositAmount: parseNumber(row[idx.totalDeposit]),
      totalWithdrawalCount: parseNumber(row[idx.totalTrxWithdrawal]),
      totalWithdrawalAmount: parseNumber(row[idx.totalWithdrawal]),
    },
    raw,
    fallback: !exact,
    kind: 'cgaming',
  };
}

export function parseCgaming(
  tables: TableInfo[],
  opts: CgamingParseOptions,
): ParseResult | null {
  const bankTable = findBankSummaryTable(tables);
  if (!bankTable) return null;
  return parseBankSummary(bankTable, opts);
}

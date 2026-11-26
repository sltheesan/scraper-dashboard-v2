import {
  ParseResult,
  emptyData,
  formatDateString,
  parseNumber,
  COMMON_FIELDS,
} from './common';

const ZOOMWLB_FIELD_SUFFIXES: Record<string, string> = {
  newRegistrationCount: 'NewPlayer',
  newDepositCount: 'FirstDeposit',
  totalDepositCount: 'DepositSuccessCount',
  totalDepositAmount: 'DepositSuccessAmount',
  totalWithdrawalCount: 'WithdrawalSuccessCount',
  totalWithdrawalAmount: 'WithdrawalSuccessAmount',
};

const SCALED_BY_1000 = new Set(['totalDepositAmount', 'totalWithdrawalAmount']);

export function zoomwlbFieldIds(
  period: 'today' | 'yesterday',
): Record<string, string> {
  const prefix = period === 'yesterday' ? 'yesterday' : 'today';
  return Object.fromEntries(
    Object.entries(ZOOMWLB_FIELD_SUFFIXES).map(([key, suffix]) => [key, prefix + suffix]),
  );
}

export function parseZoomwlb(
  fields: Record<string, string | null>,
  targetDate: Date,
): ParseResult | null {
  if (!fields || typeof fields !== 'object') return null;
  if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) return null;

  const anyValue = COMMON_FIELDS.some((k) => fields[k] != null);
  if (!anyValue) return null;

  const data = emptyData();
  for (const key of COMMON_FIELDS) {
    const n = parseNumber(fields[key]);
    (data as any)[key] = n != null && SCALED_BY_1000.has(key) ? n * 1000 : n;
  }

  return {
    data,
    reportDate: targetDate,
    reportDateString: formatDateString(targetDate),
    raw: { ...fields },
    kind: 'zoomwlb',
  };
}

import {
  ParseResult,
  emptyData,
  formatDateString,
  parseNumber,
  COMMON_FIELDS,
} from './common';

const ONEOPSPORTAL_FIELD_IDS: Record<string, string> = {
  newRegistrationCount: 'newRegister',
  newDepositCount: 'FTDCount',
  totalDepositCount: 'depositCount',
  totalDepositAmount: 'totalDeposit',
  totalWithdrawalCount: 'withdrawalCount',
  totalWithdrawalAmount: 'totalWithdraw',
};

const EXTRA_FIELD_IDS: Record<string, string> = {
  revenue: 'revenue',
  ftdAmount: 'FTDAmount',
  activeMember: 'activeMember',
  depositMember: 'depositMember',
  totalBonus: 'totalBonus',
  totalAdjustment: 'totalAdjustment',
  totalTurnover: 'totalTurnover',
  totalWinLose: 'totalWinLose',
  companyGgr: 'dbv2CompanyGgr',
  playerBalance: 'totalPlayerBalanceCash',
  playerOnline: 'playerOnline',
  sameDayRegDeposit: 'sameDayRegisterAndDepositCount',
  cashIn: 'dbv2CashIn',
  firstWithdrawalCount: 'firstWithdrawalCount',
};

export function oneopsportalFieldDefs(): Array<{ id: string; label: string }> {
  const defs: Array<{ id: string; label: string }> = [];
  for (const [label, id] of Object.entries(ONEOPSPORTAL_FIELD_IDS)) {
    defs.push({ id, label });
  }
  for (const [label, id] of Object.entries(EXTRA_FIELD_IDS)) {
    defs.push({ id, label });
  }
  return defs;
}

export function oneopsportalWaitIds(): string[] {
  return Object.values(ONEOPSPORTAL_FIELD_IDS);
}

export function parseOneopsportal(
  fields: Record<string, string | null>,
  targetDate: Date,
): ParseResult | null {
  if (!fields || typeof fields !== 'object') return null;
  if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) return null;

  const anyValue = COMMON_FIELDS.some((k) => fields[k] != null);
  if (!anyValue) return null;

  const data = emptyData();
  for (const key of COMMON_FIELDS) {
    data[key as keyof typeof data] = parseNumber(fields[key]);
  }

  return {
    data,
    reportDate: targetDate,
    reportDateString: formatDateString(targetDate),
    raw: { ...fields },
    kind: 'oneopsportal',
  };
}

const PLATFORM_CURRENCY: Record<string, string> = {
  CGAMING: 'IDR',
  ZOOMWLB: 'IDR',
  ONEOPSPORTAL: 'THB',
};

const CONVERSION_TARGETS = ['USD', 'THB', 'IDR', 'MYR'];

export interface CurrencyInfo {
  currency: string;
  rates: Record<string, number>;
}

interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

let cache: CachedRates | null = null;
const CACHE_TTL = 4 * 60 * 60 * 1000;

export function currencyForPlatform(kind: string): string {
  return PLATFORM_CURRENCY[kind] || 'USD';
}

export async function getExchangeRates(): Promise<Record<string, number> | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.rates;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (data.result === 'success' && data.rates) {
      cache = { rates: data.rates, fetchedAt: Date.now() };
      return cache.rates;
    }
    return cache?.rates ?? null;
  } catch {
    return cache?.rates ?? null;
  }
}

export function convert(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number | null {
  if (from === to) return amount;
  const fromRate = from === 'USD' ? 1 : rates[from];
  const toRate = to === 'USD' ? 1 : rates[to];
  if (!fromRate || fromRate === 0 || !toRate) return null;
  return (amount / fromRate) * toRate;
}

export function fmtCurrency(amount: number, currency: string): string {
  switch (currency) {
    case 'USD':
      if (Math.abs(amount) >= 1000) {
        return '$' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
      }
      return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'IDR':
      return 'Rp ' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'THB':
      return '฿' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'MYR':
      return 'RM ' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
    default:
      return amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + currency;
  }
}

export function convertedLabels(
  amount: number,
  nativeCurrency: string,
  rates: Record<string, number>,
): string[] {
  const results: string[] = [];
  for (const target of CONVERSION_TARGETS) {
    if (target === nativeCurrency) continue;
    const val = convert(amount, nativeCurrency, target, rates);
    if (val != null) {
      results.push('~' + fmtCurrency(val, target));
    }
  }
  return results;
}

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'CAD', 'AUD', 'JPY', 'INR', 'CHF'] as const;
export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number];

const STORAGE_KEY = 'preferred-currency';

// The Saudi riyal and the UAE dirham are pegged to the dollar and are not in the ECB rates: the official pegs are used.
const PEGGED_RATES: Record<string, number> = { SAR: 3.75, AED: 3.6725 };

interface CurrencyContextValue {
  preferred: CurrencyCode;
  setPreferred: (c: CurrencyCode) => void;
  rates: Record<string, number> | null; // base = USD; rates[X] = X per 1 USD
  ratesUpdatedAt: string | null;
  isLoading: boolean;
  isError: boolean;
  convert: (amount: number, from: string) => number | null;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

async function fetchRates(): Promise<{ rates: Record<string, number>; date: string }> {
  // Frankfurter: ECB rates, no API key, CORS-enabled. Base USD.
  const symbols = SUPPORTED_CURRENCIES.filter(c => c !== 'USD' && !(c in PEGGED_RATES)).join(',');
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols}`);
  if (!res.ok) throw new Error('Failed to load FX rates');
  const json = await res.json();
  return { rates: { USD: 1, ...PEGGED_RATES, ...json.rates }, date: json.date };
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [preferred, setPreferredState] = useState<CurrencyCode>(() => {
    if (typeof window === 'undefined') return 'USD';
    const saved = localStorage.getItem(STORAGE_KEY) as CurrencyCode | null;
    return saved && SUPPORTED_CURRENCIES.includes(saved) ? saved : 'USD';
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, preferred); } catch {}
  }, [preferred]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['fx-rates-usd'],
    queryFn: fetchRates,
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const value = useMemo<CurrencyContextValue>(() => {
    const rates = data?.rates ?? (isError ? { USD: 1, ...PEGGED_RATES } : null);
    const convert = (amount: number, from: string): number | null => {
      if (!Number.isFinite(amount)) return null;
      const src = (from || 'USD').toUpperCase();
      if (src === preferred) return amount;
      if (!rates) return null;
      const fromRate = rates[src];
      const toRate = rates[preferred];
      if (!fromRate || !toRate) return null;
      // amount in USD = amount / fromRate; then * toRate
      return (amount / fromRate) * toRate;
    };
    return {
      preferred,
      setPreferred: setPreferredState,
      rates,
      ratesUpdatedAt: data?.date ?? null,
      isLoading,
      isError,
      convert,
    };
  }, [preferred, data, isLoading, isError]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

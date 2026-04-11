import { format, formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const getLocale = (locale: 'en' | 'ar' = 'en') => locale === 'ar' ? ar : enUS;

export function formatDate(date: string | Date, locale: 'en' | 'ar' = 'en'): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: getLocale(locale) });
}

export function formatDateTime(date: string | Date, locale: 'en' | 'ar' = 'en'): string {
  return format(new Date(date), 'dd MMM yyyy, HH:mm', { locale: getLocale(locale) });
}

export function formatRelativeTime(date: string | Date, locale: 'en' | 'ar' = 'en'): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: getLocale(locale) });
}

export function formatCurrency(amount: number, currency: string = 'USD', locale: 'en' | 'ar' = 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number, locale: 'en' | 'ar' = 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US').format(num);
}

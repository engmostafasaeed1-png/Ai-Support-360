import type { TFunction } from 'i18next';
import { parseMissingRequired } from '@/lib/profileSubmission';

export function requiredProfileMessage(message: string, t: TFunction): string {
  const missing = parseMissingRequired(message);
  if (!missing) return message;
  const fields = missing.map(key => t(`profileSubmit.field.${key}`, {
    defaultValue: key === 'company_name' ? t('client_approval.item_company', 'Company name')
      : key === 'sap_modules' ? t('client_approval.item_modules', 'SAP modules') : key.replace(/_/g, ' '),
  })).join(', ');
  return t('requiredProfile.message', { fields, defaultValue: 'Complete these required fields before submitting: {{fields}}.' });
}

export function requiredCount(rows: unknown, id: string): number | null {
  if (!Array.isArray(rows)) return null;
  const row = rows.find(r => r?.consultant_id === id);
  return Array.isArray(row?.missing) ? new Set(row.missing).size : null;
}
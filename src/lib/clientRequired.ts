export const CLIENT_REQUIRED_LABEL_KEYS: Record<string, string> = {
  company_name: 'client_onboarding.field_company_name',
  sap_modules: 'client_onboarding.field_sap_modules',
};

/** "missing_required:company_name,sap_modules" -> ['company_name','sap_modules']; anything else -> null. */
export function parseMissingRequired(message: unknown): string[] | null {
  const m = String(message ?? '');
  const i = m.indexOf('missing_required:');
  if (i < 0) return null;
  const keys = m.slice(i + 'missing_required:'.length).split(/[\s"]/)[0].split(',').map((k) => k.trim()).filter(Boolean);
  return keys.length ? keys : null;
}

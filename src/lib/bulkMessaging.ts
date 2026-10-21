// Feature R display helpers. Rules live in the shared module (mirrored by the database in docs/sql/bulk-messaging.sql).
export {
  BRAND_IMAGES, BROADCAST_TYPES, CATEGORIES, CHANNELS, DEFAULTS, LIMITS, PROVIDERS, PROVIDER_SECRETS, SITE, VARIABLES,
  confirmationOk, exclusionReason, firstName, footerText, needsTypedConfirmation, normalizePhone, parseMessage, pickText,
  providerStatus, recipientPlan, renderVariables, riskWarnings, secretFindings, smsLink, throttleBudget, toPlainText,
  whatsappLink, withinDailyCap, zonedToUtc,
  type Block, type BrandImage, type Category, type Channel, type Inline, type RiskKind, type SecretKind, type Vars,
} from '../../supabase/functions/_shared/bulkMessaging';

export type AudienceKind = 'users' | 'filter' | 'group' | 'emails' | 'saved';
export interface AudienceFilter {
  roles: string[];
  countries: string[];
  sap_areas: string[];
  badges: string[];
  verification: string[];
  incomplete_profile: boolean;
  location_missing: boolean;
  policy_not_acknowledged: boolean;
  inactive_days: number | null;
}
export const EMPTY_FILTER: AudienceFilter = {
  roles: [], countries: [], sap_areas: [], badges: [], verification: [],
  incomplete_profile: false, location_missing: false, policy_not_acknowledged: false, inactive_days: null,
};

/** The audience definition sent to the database (only the fields of the chosen kind). */
export function buildAudience(kind: AudienceKind, v: { userIds?: string[]; filter?: AudienceFilter; groupId?: string; emails?: string; savedId?: string }) {
  if (kind === 'users') return { kind, user_ids: (v.userIds ?? []).slice(0, 5000) };
  if (kind === 'group') return { kind, group_id: v.groupId ?? '' };
  if (kind === 'saved') return { kind, audience_id: v.savedId ?? '' };
  if (kind === 'emails') return { kind, emails: parseEmails(v.emails ?? '') };
  const f = v.filter ?? EMPTY_FILTER;
  const out: Record<string, unknown> = { kind: 'filter' };
  for (const k of ['roles', 'countries', 'sap_areas', 'badges', 'verification'] as const) if (f[k].length) out[k] = f[k];
  for (const k of ['incomplete_profile', 'location_missing', 'policy_not_acknowledged'] as const) if (f[k]) out[k] = true;
  if (f.inactive_days && f.inactive_days > 0) out.inactive_days = Math.min(3650, Math.floor(f.inactive_days));
  return out;
}

/** Pasted addresses: split on commas, semicolons, spaces and lines; lower-case; deduplicated; at most 2000. */
export function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const e = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) seen.add(e);
    if (seen.size >= 2000) break;
  }
  return [...seen];
}

export const splitList = (text: string) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);

/** Selected users handed from Admin › Users to the compose screen (kept in this tab only). */
export const SELECTED_KEY = 'bm:selected-users';

// Support agreements in the browser: the shared rules (one source with the database mirror and tests) plus form
// defaults and small display helpers. Nothing here decides money; the database functions do.
export * from '../../../supabase/functions/_shared/supportAgreements';
import type { BankTerms, SaModel, SaStatus, SaTerms } from '../../../supabase/functions/_shared/supportAgreements';
import { formatMinutes, SEVERITY_KEYS, type PolicyBody } from '@/lib/sla/policy';

export interface SaRequest {
  expected_hours_per_month: number | null;
  duration_months: number | null;
  budget: { min: number | null; max: number | null; currency: string } | null;
  show_budget: boolean;
  language: string;
  timezone: string | null;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

export const DEFAULT_BANK: BankTerms = { hours_per_month: 20, rollover: 'none', rollover_hours: 0, rollover_months: 0, unused: 'charge', overage_rate: null };

/** A fresh draft: starts in two weeks, 12 months, 30 days notice, platform SLA, monthly reporting, NDA required. */
export function emptyTerms(model: SaModel = 'payg', start = plusDays(today(), 14)): SaTerms {
  const end = new Date(Date.parse(`${start}T00:00:00Z`));
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return {
    name: '',
    scope: { modules: [], versions: [], systems: [], covered: '', not_covered: '' },
    term: { start_date: start, end_date: end.toISOString().slice(0, 10), notice_days: 30, auto_renew: false, renew_months: 12 },
    model,
    bank: model === 'hours_bank' ? { ...DEFAULT_BANK } : null,
    capacity_hours_per_week: model === 'availability' ? 8 : null,
    rate: { hourly_rate: 0, currency: 'USD', s1_multiplier: null, ooh_multiplier: null, overage_rate: null },
    sla: { policy_id: null, version: null, summary: '' },
    reporting: 'monthly',
    language: 'en',
    timezone: null,
    nda_required: true,
    team: [],
  };
}

export const emptyRequest = (): SaRequest => ({
  expected_hours_per_month: 20, duration_months: 12, budget: null, show_budget: false, language: 'en', timezone: null, notes: '',
});

/** Switching model keeps everything else and fills the model's own part with defaults. */
export function withModel(t: SaTerms, model: SaModel): SaTerms {
  return {
    ...t, model,
    bank: model === 'hours_bank' ? (t.bank ?? { ...DEFAULT_BANK }) : null,
    capacity_hours_per_week: model === 'availability' ? (t.capacity_hours_per_week ?? 8) : null,
  };
}

/**
 * The exact SLA targets an applicant accepts ("S1: response 1 h, resolution 4 h; ..."), written into the terms when
 * the client picks a policy version, so the acceptance checkbox and the summary PDF show the same text.
 */
export function slaSummary(name: string, version: number | null, body: Pick<PolicyBody, 'severities'> | null, lang: 'en' | 'ar' = 'en'): string {
  const head = version ? `${name} (v${version})` : name;
  if (!body) return head;
  const parts = SEVERITY_KEYS.map((k) => {
    const s = body.severities[k];
    if (!s) return null;
    return lang === 'ar'
      ? `${k}: استجابة ${formatMinutes(s.response_min, 'ar')}، حل ${formatMinutes(s.resolution_min, 'ar')}`
      : `${k}: response ${formatMinutes(s.response_min, 'en')}, resolution ${formatMinutes(s.resolution_min, 'en')}`;
  }).filter(Boolean);
  return `${head}: ${parts.join(lang === 'ar' ? '؛ ' : '; ')}`;
}

export const STATUS_COLOR: Record<SaStatus, 'muted' | 'info' | 'warning' | 'success' | 'destructive'> = {
  draft: 'muted', open: 'info', negotiating: 'warning', agreed: 'info', active: 'success', suspended: 'warning',
  renewal_due: 'warning', expired: 'muted', terminated: 'destructive', archived: 'muted',
};

/** Lifecycle shown as steps (ticket-tracking style); side states map onto the nearest main step. */
export const MAIN_STEPS: SaStatus[] = ['draft', 'open', 'negotiating', 'agreed', 'active', 'renewal_due'];
export function stepIndex(s: SaStatus): number {
  if (s === 'suspended') return MAIN_STEPS.indexOf('active');
  if (s === 'expired' || s === 'terminated' || s === 'archived') return MAIN_STEPS.length;
  return Math.max(0, MAIN_STEPS.indexOf(s));
}

/** Database error -> short code for translated messages (sa_forbidden, sa_rate_out_of_bounds, ...). */
export function saErrorCode(message: string | undefined): string {
  const m = /(sa_[a-z_]+)/.exec(message ?? '');
  return m ? m[1] : 'generic';
}

/** Problem codes inside "sa_terms_invalid: modules,start_past" -> ['modules', 'start_past']. */
export function saProblemList(message: string | undefined): string[] {
  const m = /sa_(?:terms_invalid|rate_out_of_bounds):\s*([a-z_,]+)/.exec(message ?? '');
  return m ? m[1].split(',').filter(Boolean) : [];
}

/** Offer patch from the counter form: only the fields that changed (the database also ignores anything else). */
export function offerPatch(t: SaTerms, f: { hourly_rate?: number; hours_per_month?: number; capacity?: number; start_date?: string; end_date?: string | null; notice_days?: number }) {
  const patch: Record<string, unknown> = {};
  if (f.hourly_rate !== undefined && f.hourly_rate !== t.rate.hourly_rate) patch.rate = { hourly_rate: f.hourly_rate };
  if (t.model === 'hours_bank' && f.hours_per_month !== undefined && f.hours_per_month !== t.bank?.hours_per_month) patch.bank = { hours_per_month: f.hours_per_month };
  if (t.model === 'availability' && f.capacity !== undefined && f.capacity !== t.capacity_hours_per_week) patch.capacity_hours_per_week = f.capacity;
  const term: Record<string, unknown> = {};
  if (f.start_date && f.start_date !== t.term.start_date) term.start_date = f.start_date;
  if (f.end_date !== undefined && f.end_date !== t.term.end_date) term.end_date = f.end_date;
  if (f.notice_days !== undefined && f.notice_days !== t.term.notice_days) term.notice_days = f.notice_days;
  if (Object.keys(term).length) patch.term = term;
  return patch;
}

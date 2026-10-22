import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { deviceId, parseReferralSettings, parseTiers, REFERRAL_DEFAULTS, type ReferralSettings, type Tier } from '@/lib/referrals';

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
export const referralRpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<RpcResult> }).rpc(fn, args);

/** Plain error text from the database (our RAISE messages are written for people). */
export function rpcMessage(e: { message?: string } | null | undefined, fallback: string): string {
  const m = String(e?.message ?? '').trim();
  if (!m || /function .* does not exist|schema cache|permission denied|PGRST/i.test(m)) return fallback;
  return m;
}

export interface PublicReferral { available: boolean; settings: ReferralSettings }

/** referral_public_settings() - fails closed: nothing referral-related shows until the prepared SQL is applied. */
export function usePublicReferralSettings(): PublicReferral {
  const q = useQuery({
    queryKey: ['referral-public-settings'],
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<PublicReferral> => {
      const { data, error } = await referralRpc('referral_public_settings');
      if (error || !data || typeof data !== 'object') return { available: false, settings: REFERRAL_DEFAULTS };
      return { available: true, settings: parseReferralSettings(data) };
    },
  });
  return q.data ?? { available: false, settings: REFERRAL_DEFAULTS };
}

export interface EarningsRow { currency: string; pending: number; available: number; held: number; in_payout: number; paid: number; lifetime: number }
export interface ReferralOverview {
  settings: ReferralSettings;
  code: string;
  previous_code: string | null;
  edits_left: number;
  disabled: boolean;
  terms_accepted_version: number | null;
  funnel: { clicks: number; signups: number; verified: number; paying: number };
  earnings: EarningsRow[];
  eligibility: { verified: boolean; policy: boolean; suspended: boolean; payout_details: boolean };
  /** Referrer checklist: AI interview passed -> terms acknowledged -> active (decided in the database). */
  activation: { pass_mark: number; interview_passed: boolean; best_score: number | null; acknowledged: boolean; active: boolean };
  /** "Who invited you?" is open (new accounts: first days; existing consultants: until the launch window ends). */
  claim: { can_claim: boolean; until: string | null };
  /** Verified, non-suspended referred consultants counted for the tier (from the database). */
  tier_count: number;
}

const n = (v: unknown) => Number(v) || 0;

export function parseOverview(o: Record<string, unknown>): ReferralOverview {
  const f = (o.funnel ?? {}) as Record<string, unknown>;
  const el = (o.eligibility ?? {}) as Record<string, unknown>;
  const ac = (o.activation ?? {}) as Record<string, unknown>;
  const cl = (o.claim ?? {}) as Record<string, unknown>;
  return {
    settings: parseReferralSettings(o.settings),
    code: String(o.code ?? ''),
    previous_code: o.previous_code ? String(o.previous_code) : null,
    edits_left: n(o.edits_left),
    disabled: o.disabled === true,
    terms_accepted_version: o.terms_accepted_version == null ? null : n(o.terms_accepted_version),
    funnel: { clicks: n(f.clicks), signups: n(f.signups), verified: n(f.verified), paying: n(f.paying) },
    earnings: (Array.isArray(o.earnings) ? o.earnings : []).map((e) => {
      const r = e as Record<string, unknown>;
      return { currency: String(r.currency ?? 'USD'), pending: n(r.pending), available: n(r.available), held: n(r.held), in_payout: n(r.in_payout), paid: n(r.paid), lifetime: n(r.lifetime) };
    }),
    tier_count: n(((o.tier ?? {}) as Record<string, unknown>).count ?? f.verified),
    claim: { can_claim: cl.can_claim === true, until: cl.until ? String(cl.until) : null },
    activation: {
      pass_mark: ac.pass_mark == null ? 50 : n(ac.pass_mark),
      interview_passed: ac.interview_passed === true,
      best_score: ac.best_score == null ? null : n(ac.best_score),
      acknowledged: ac.acknowledged === true,
      active: ac.active === true,
    },
    eligibility: { verified: el.verified === true, policy: el.policy !== false, suspended: el.suspended === true, payout_details: el.payout_details === true },
  };
}

/** null data + available=false means the programme SQL is not applied yet (the page falls back to the old one). */
export function useReferralOverview(enabled = true) {
  return useQuery({
    queryKey: ['referral-overview'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<{ available: boolean; data: ReferralOverview | null; error?: string }> => {
      const { data, error } = await referralRpc('my_referral_overview', { _device: deviceId() || null });
      if (error) {
        const missing = /function .* does not exist|schema cache|PGRST202|404/i.test(error.message);
        return { available: !missing, data: null, error: missing ? undefined : error.message };
      }
      return { available: true, data: parseOverview((data ?? {}) as Record<string, unknown>) };
    },
  });
}

export interface MyReferral {
  referred_name: string; status: string; attributed_at: string; verified: boolean; first_paid_at: string | null; window_ends_at: string | null;
  earned: Record<string, number>; activation_status: 'pending' | 'active' | 'expired'; chip: string; my_next: string; their_next: string;
  activated_at: string | null; activation_expires_at: string | null; they_passed: boolean; they_acknowledged: boolean;
}

/** The referred consultant's own invitation (who invited them, masked; activation steps). null = not referred / SQL not applied. */
export interface MyInvite {
  referrer_name: string; activation_status: 'pending' | 'active' | 'expired'; chip: string; my_next: string; their_next: string;
  attributed_at: string; activation_expires_at: string | null; activated_at: string | null; i_passed_at: string | null; they_passed: boolean;
  i_acknowledged_at: string | null; they_acknowledged: boolean; pass_mark: number; rate_percent: number; tiers?: Tier[]; months: number; terms_version: number;
}

export function useMyReferralInvite(enabled = true) {
  return useQuery({
    queryKey: ['referral-invite'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<MyInvite | null> => {
      const { data, error } = await referralRpc('my_referral_invite');
      if (error || !data || typeof data !== 'object') return null;
      const inv = data as MyInvite;
      return { ...inv, tiers: Array.isArray(inv.tiers) ? parseTiers(inv.tiers) : undefined };
    },
  });
}

export interface TermsVersion { version: number; body_en: string; body_ar: string; is_draft: boolean }

export function useReferralTerms(version: number | null | undefined) {
  return useQuery({
    queryKey: ['referral-terms', version],
    enabled: !!version,
    retry: false,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<TermsVersion | null> => {
      const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } } })
        .from('referral_terms_versions').select('version, body_en, body_ar, is_draft').eq('version', version).maybeSingle();
      if (error || !data) return null;
      return data as TermsVersion;
    },
  });
}

/** Append-only acknowledgement (language, browser and hashed network are stored by the database). */
export async function acceptReferralTerms(version: number, source: 'page' | 'share' | 'popup', lang: 'en' | 'ar') {
  return referralRpc('referral_accept_terms', {
    _version: version, _source: source, _language: lang, _user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
  });
}
export interface HistoryLine { created_at: string; kind: string; status: string; amount: number; currency: string; fee_amount: number | null; rate_percent: number | null; tier_name?: string | null; referred_name: string | null; note: string | null; available_at: string | null; paid_at: string | null }

export function useMyReferralList(enabled: boolean) {
  return useQuery({
    queryKey: ['referral-list'],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await referralRpc('my_referrals');
      if (error) throw new Error(error.message);
      return (data ?? []) as MyReferral[];
    },
  });
}

export function useMyReferralHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['referral-history'],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await referralRpc('my_referral_history', { _limit: 300 });
      if (error) throw new Error(error.message);
      return ((data ?? []) as HistoryLine[]).map((l) => ({ ...l, amount: Number(l.amount) || 0 }));
    },
  });
}

export function useInvalidateReferral() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['referral-overview', 'referral-list', 'referral-history', 'referral-invite']) qc.invalidateQueries({ queryKey: [k] });
  };
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { deviceId, parseReferralSettings, REFERRAL_DEFAULTS, type ReferralSettings } from '@/lib/referrals';

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
}

const n = (v: unknown) => Number(v) || 0;

export function parseOverview(o: Record<string, unknown>): ReferralOverview {
  const f = (o.funnel ?? {}) as Record<string, unknown>;
  const el = (o.eligibility ?? {}) as Record<string, unknown>;
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

export interface MyReferral { referred_name: string; status: string; attributed_at: string; verified: boolean; first_paid_at: string | null; window_ends_at: string | null; earned: Record<string, number> }
export interface HistoryLine { created_at: string; kind: string; status: string; amount: number; currency: string; fee_amount: number | null; rate_percent: number | null; referred_name: string | null; note: string | null; available_at: string | null; paid_at: string | null }

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
    for (const k of ['referral-overview', 'referral-list', 'referral-history']) qc.invalidateQueries({ queryKey: [k] });
  };
}

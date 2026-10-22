import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { referralRpc } from '@/hooks/useReferralProgram';
import {
  navIndicator, parsePayouts, parseRewardLines, pulseActive, readReferNav, REFER_NAV_EVENT, writeReferNav,
  type ReferralPayoutRow, type RewardLine,
} from '@/lib/referralTracking';

/** True when the database function is simply not there yet (docs/sql/referral-tracking.sql not applied). */
const isMissing = (m: string) => /function .* does not exist|schema cache|PGRST202|404/i.test(m);

export interface Tracked<T> { available: boolean; data: T }

/** Own reward lines with the calculation breakdown (my_referral_reward_lines). */
export function useReferralRewardLines(enabled: boolean) {
  return useQuery({
    queryKey: ['referral-reward-lines'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<Tracked<RewardLine[]>> => {
      const { data, error } = await referralRpc('my_referral_reward_lines', { _limit: 2000 });
      if (error) {
        if (isMissing(error.message)) return { available: false, data: [] };
        throw new Error(error.message);
      }
      return { available: true, data: parseRewardLines(data) };
    },
  });
}

export function useReferralPayouts(enabled: boolean) {
  return useQuery({
    queryKey: ['referral-payouts'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<Tracked<ReferralPayoutRow[]>> => {
      const { data, error } = await referralRpc('my_referral_payouts');
      if (error) {
        if (isMissing(error.message)) return { available: false, data: [] };
        throw new Error(error.message);
      }
      return { available: true, data: parsePayouts(data) };
    },
  });
}

export interface TrackingInfo {
  terms: { current_version: number; published_at: string | null; is_draft: boolean; accepted_version: number | null; accepted_at: string | null; accepted_current_at: string | null } | null;
  rejected: Array<{ referred_name: string; attributed_at: string; decided_at: string; reason: 'account_closed' | 'review_failed' | 'rules' }>;
}

export function useReferralTrackingInfo(enabled: boolean) {
  return useQuery({
    queryKey: ['referral-tracking'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<Tracked<TrackingInfo>> => {
      const { data, error } = await referralRpc('my_referral_tracking');
      if (error || !data || typeof data !== 'object') return { available: false, data: { terms: null, rejected: [] } };
      const o = data as Record<string, unknown>;
      const t = (o.terms ?? null) as Record<string, unknown> | null;
      return {
        available: true,
        data: {
          terms: t ? {
            current_version: Number(t.current_version) || 1,
            published_at: t.published_at ? String(t.published_at) : null,
            is_draft: t.is_draft !== false,
            accepted_version: t.accepted_version == null ? null : Number(t.accepted_version),
            accepted_at: t.accepted_at ? String(t.accepted_at) : null,
            accepted_current_at: t.accepted_current_at ? String(t.accepted_current_at) : null,
          } : null,
          rejected: Array.isArray(o.rejected) ? (o.rejected as TrackingInfo['rejected']) : [],
        },
      };
    },
  });
}

/**
 * Menu pill state: pulse (first 14 days or until opened), dot for new rewards, count of referrals waiting. Fails closed
 * (no dot, no count) when the function is missing; never throws.
 */
export function useReferNav(enabled: boolean) {
  const [seen, setSeen] = useState(readReferNav);
  useEffect(() => {
    if (!enabled) return;
    if (seen.first == null) writeReferNav({ first: Date.now() });
    const on = () => setSeen(readReferNav());
    window.addEventListener(REFER_NAV_EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(REFER_NAV_EVENT, on); window.removeEventListener('storage', on); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({
    queryKey: ['referral-nav-state'],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await referralRpc('my_referral_nav_state');
      if (error || !data || typeof data !== 'object') return null;
      return data as { enabled?: boolean; latest_line_at?: string | null; pending_referrals?: number };
    },
  });
  const ind = navIndicator(q.data, seen.seenLinesAt);
  return { pulse: enabled && pulseActive(seen), dot: ind.dot, count: ind.count };
}

/** Called by the Refer & earn page: stops the pulse and clears the new-earnings dot. */
export function markReferPageOpened(): void {
  writeReferNav({ opened: Date.now(), seenLinesAt: new Date().toISOString() });
}

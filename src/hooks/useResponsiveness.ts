import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import {
  isLevel, readRespSettings, RESP_DEFAULTS,
  type RespExclusion, type RespKind, type RespLevel, type RespMetrics, type RespOutcome, type RespSettings,
} from '../../supabase/functions/_shared/responsiveness';

type RpcResult = { data: unknown; error: { message: string } | null };
// Called as methods: supabase.rpc/from read `this`, so a detached reference throws and every call looks "not applied".
const rpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<RpcResult> }).rpc(fn, args);
// Feature M tables are not in the generated types until docs/sql/responsiveness.sql is applied.
const from = (table: string): any => (supabase as unknown as { from: (t: string) => any }).from(table);

export interface PublicResponsiveness { level: RespLevel; median_minutes: number | null; response_rate: number | null; stars: number | null }
export interface PublicResponsivenessData {
  publicOn: boolean;
  reviewWeight: number;
  byId: Map<string, PublicResponsiveness>;
  /** Levels for the best-match sort; null while the owner keeps responsiveness private. */
  levels: Map<string, RespLevel> | null;
}

const EMPTY: PublicResponsivenessData = { publicOn: false, reviewWeight: RESP_DEFAULTS.review_weight, byId: new Map(), levels: null };

/** What clients may see: level, median response time and rate. Nothing until the owner switches responsiveness_public on (or before the SQL is applied). */
export function usePublicResponsiveness(): PublicResponsivenessData {
  const { signedIn } = useSessionReady();
  const q = useQuery({
    queryKey: ['responsiveness-public'],
    enabled: signedIn,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<PublicResponsivenessData> => {
      const cfg = await rpc('responsiveness_public_config');
      const c = (cfg.data ?? {}) as { public?: boolean; review_weight?: number };
      if (cfg.error || c.public !== true) return EMPTY;
      const { data, error } = await rpc('responsiveness_public_summary', { _consultant_ids: null });
      if (error) return EMPTY;
      const byId = new Map<string, PublicResponsiveness>();
      for (const r of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        if (typeof r.consultant_id !== 'string') continue;
        byId.set(r.consultant_id, {
          level: isLevel(r.level) ? r.level : 'new',
          median_minutes: typeof r.median_minutes === 'number' ? r.median_minutes : null,
          response_rate: typeof r.response_rate === 'number' ? r.response_rate : null,
          stars: r.stars == null ? null : Number(r.stars),
        });
      }
      return {
        publicOn: true,
        reviewWeight: typeof c.review_weight === 'number' ? c.review_weight : RESP_DEFAULTS.review_weight,
        byId,
        levels: new Map([...byId].map(([id, v]) => [id, v.level])),
      };
    },
  });
  return q.data ?? EMPTY;
}

export type Split = { main: RespMetrics; critical: RespMetrics; chat: RespMetrics };
export interface MyEvent {
  id: string;
  kind: RespKind;
  received_at: string;
  due_at: string | null;
  responded_at: string | null;
  resolved_at: string | null;
  outcome: RespOutcome;
  counted: boolean;
  excluded_reason: RespExclusion | null;
  is_critical: boolean;
  ticket_title: string | null;
  dispute_status: 'pending' | 'upheld' | 'rejected' | null;
  dispute_note: string | null;
}
export interface MyResponsiveness {
  publicOn: boolean;
  settings: RespSettings;
  summary: {
    level: RespLevel; public_level: RespLevel; counted_90d: number; rate_90d: number | null; median_90d: number | null;
    no_response_30d: number; warnings_sent: number; stars: number | null; computed_at: string | null;
  };
  stats: { d30?: Split; d90?: Split; all?: Split; trend?: Array<{ week: string; counted: number; rate: number | null; median: number | null }> };
  capacity: number | null;
  activeTickets: number;
  events: MyEvent[];
}

export const MY_RESPONSIVENESS_KEY = ['my-responsiveness'] as const;

/** The consultant's own statistics (recalculated on demand by the database); error until the SQL is applied. */
export function useMyResponsiveness() {
  const { signedIn } = useSessionReady();
  return useQuery({
    queryKey: MY_RESPONSIVENESS_KEY,
    enabled: signedIn,
    retry: false,
    queryFn: async (): Promise<MyResponsiveness> => {
      const { data, error } = await rpc('my_responsiveness');
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as Record<string, any>;
      const s = (d.summary ?? {}) as Record<string, any>;
      return {
        publicOn: d.public_on === true,
        settings: readRespSettings(d.settings),
        summary: {
          level: isLevel(s.level) ? s.level : 'new',
          public_level: isLevel(s.public_level) ? s.public_level : 'new',
          counted_90d: Number(s.counted_90d) || 0,
          rate_90d: s.rate_90d == null ? null : Number(s.rate_90d),
          median_90d: s.median_90d == null ? null : Number(s.median_90d),
          no_response_30d: Number(s.no_response_30d) || 0,
          warnings_sent: Number(s.warnings_sent) || 0,
          stars: s.stars == null ? null : Number(s.stars),
          computed_at: s.computed_at ?? null,
        },
        stats: (d.stats ?? {}) as MyResponsiveness['stats'],
        capacity: d.capacity == null ? null : Number(d.capacity),
        activeTickets: Number(d.active_tickets) || 0,
        events: (Array.isArray(d.events) ? d.events : []) as MyEvent[],
      };
    },
  });
}

export interface UnavailablePeriod { id: string; starts_at: string; ends_at: string; reason: string | null }

export function useUnavailablePeriods(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ['unavailable-periods', consultantId],
    enabled: !!consultantId,
    retry: false,
    queryFn: async (): Promise<UnavailablePeriod[]> => {
      const { data, error } = await from('consultant_unavailable_periods')
        .select('id, starts_at, ends_at, reason')
        .eq('consultant_id', consultantId)
        .gte('ends_at', new Date().toISOString())
        .order('starts_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as UnavailablePeriod[];
    },
  });
}

export async function addUnavailablePeriod(consultantId: string, startsAt: string, endsAt: string, reason: string): Promise<void> {
  const { error } = await from('consultant_unavailable_periods').insert({ consultant_id: consultantId, starts_at: startsAt, ends_at: endsAt, reason: reason || null });
  if (error) throw new Error(error.message);
}

export async function removeUnavailablePeriod(id: string): Promise<void> {
  const { error } = await from('consultant_unavailable_periods').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setCapacity(max: number | null): Promise<void> {
  const { error } = await rpc('consultant_set_capacity', { _max: max });
  if (error) throw new Error(error.message);
}

export async function disputeNoResponse(eventId: string, reason: string): Promise<void> {
  const { error } = await rpc('consultant_dispute_no_response', { _event_id: eventId, _reason: reason });
  if (error) throw new Error(error.message);
}

export interface ResponsivenessNotice { id: string; kind: string; event_id: string; count_30d: number; warnings_total: number; created_at: string }

/** Kinds that change the consultant's statistics: shown as a popup. Others (not_counted) are informational only. */
export const POPUP_NOTICE_KINDS = (kind: string) => kind !== 'not_counted';

export const RESPONSIVENESS_NOTICES_KEY = ['responsiveness-notices'] as const;

/**
 * Unacknowledged notices of the signed-in user. Always filtered to the user's own rows: administrators may read every
 * consultant's notices, and they could never acknowledge someone else's (the popup would come back for ever).
 * Re-read on window focus so a notice acknowledged in another tab disappears here too.
 */
export function useResponsivenessNotices(enabled: boolean) {
  return useQuery({
    queryKey: RESPONSIVENESS_NOTICES_KEY,
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ResponsivenessNotice[]> => {
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user?.id;
      if (!uid) return [];
      const { data, error } = await from('responsiveness_notices')
        .select('id, kind, event_id, count_30d, warnings_total, created_at')
        .eq('user_id', uid)
        .is('acked_at', null)
        .order('created_at', { ascending: true })
        .limit(20);
      if (error) return [];
      return (data ?? []) as ResponsivenessNotice[];
    },
  });
}

/** Acknowledge one notice by its NOTICE id (not the event id). Throws on failure so the popup can stay and retry. */
export async function ackResponsivenessNotice(id: string): Promise<void> {
  const { error } = await rpc('ack_responsiveness_notice', { _notice_id: id });
  if (error) throw new Error(error.message || 'Could not save');
}

// ---------------------------------------------------------------- admin

export interface AdminResponsivenessRow {
  consultant_id: string; name: string | null; level: RespLevel; public_level: RespLevel; counted_90d: number;
  rate_90d: number | null; median_90d: number | null; no_response_30d: number; warnings_sent: number;
  disputes_open: number; disputes_total: number; computed_at: string;
}

export function useAdminResponsiveness() {
  return useQuery({
    queryKey: ['admin-responsiveness'],
    retry: false,
    queryFn: async (): Promise<AdminResponsivenessRow[]> => {
      const { data, error } = await rpc('admin_responsiveness_overview');
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as AdminResponsivenessRow[];
    },
  });
}

export interface AdminDispute {
  id: string; event_id: string; consultant_id: string; name: string | null; reason: string; status: 'pending' | 'upheld' | 'rejected';
  created_at: string; reviewed_at: string | null; admin_note: string | null; kind: RespKind; received_at: string; due_at: string | null;
  excluded_reason: string | null; ticket_title: string | null;
}

export function useAdminResponsivenessDisputes() {
  return useQuery({
    queryKey: ['admin-responsiveness-disputes'],
    retry: false,
    queryFn: async (): Promise<AdminDispute[]> => {
      const { data, error } = await rpc('admin_responsiveness_disputes');
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as AdminDispute[];
    },
  });
}

export async function reviewDispute(id: string, uphold: boolean, note: string): Promise<void> {
  const { error } = await rpc('admin_review_responsiveness_dispute', { _dispute_id: id, _uphold: uphold, _note: note });
  if (error) throw new Error(error.message);
}

export async function recomputeResponsiveness(): Promise<number> {
  const { data, error } = await rpc('admin_recompute_responsiveness');
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

export function useResponsivenessSettings() {
  return useQuery({
    queryKey: ['responsiveness-settings'],
    retry: false,
    queryFn: async (): Promise<RespSettings> => {
      const { data, error } = await rpc('responsiveness_settings');
      if (!error) return readRespSettings(data);
      // Before the SQL is applied: read the raw row (or the defaults).
      const raw = await from('platform_settings').select('value').eq('key', 'responsiveness_settings').maybeSingle();
      return readRespSettings(raw?.data?.value ?? null);
    },
  });
}

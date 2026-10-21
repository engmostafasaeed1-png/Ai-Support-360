import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import {
  HOLD_MAX_DAYS_DEFAULT, holdState, parseHoldDirectoryMode, sortIntervals, weeklyFromSlots, workingWeekFor,
  type HoldDirectoryMode, type HoldRow, type WeeklyInterval,
} from '@/lib/availabilityRules';

// The prepared database update (docs/sql/availability-hold.sql) adds these; until it is applied every call fails and the
// hold features stay hidden, while the weekly availability editor keeps working on the existing slots table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const MY_AVAILABILITY_KEY = ['my-weekly-availability'] as const;

export interface MyAvailabilityStatus {
  required: boolean;
  has_weekly: boolean;
  grace_started_at: string | null;
  grace_days: number;
  deadline: string | null;
  blocked: boolean;
  hold_max_days: number;
  hold_directory: HoldDirectoryMode;
  on_hold: boolean;
}
export interface MyHold extends HoldRow { reason: string | null; set_by_admin: boolean; admin_reason: string | null }

export interface MyAvailability {
  consultantId: string;
  userId: string;
  timezone: string;
  createdAt: string | null;
  availabilityStatus: string | null;
  weekly: WeeklyInterval[];
  /** Ids of the saved recurring slots, so a save can replace exactly them (one-date slots are kept). */
  weeklySlotIds: string[];
  status: MyAvailabilityStatus | null;
  holds: MyHold[] | null;
}

export function useMyAvailability() {
  const { signedIn } = useSessionReady();
  return useQuery({
    queryKey: MY_AVAILABILITY_KEY,
    enabled: signedIn,
    staleTime: 30_000,
    queryFn: async (): Promise<MyAvailability | null> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      const { data: c, error } = await db.from('consultants').select('id, timezone, created_at, availability_status').eq('user_id', session.user.id).maybeSingle();
      if (error) throw error;
      if (!c) return null;
      const { data: slots, error: sErr } = await db.from('availability_slots').select('id, day_of_week, start_time, end_time, specific_date').eq('consultant_id', c.id);
      if (sErr) throw sErr;
      const recurring = (slots ?? []).filter((s: { day_of_week: number | null; specific_date: string | null }) => s.day_of_week != null && !s.specific_date);
      let status: MyAvailabilityStatus | null = null;
      try {
        const { data: st, error: stErr } = await db.rpc('my_availability_status');
        if (!stErr && st && typeof st === 'object') status = { ...st, hold_directory: parseHoldDirectoryMode(st.hold_directory) } as MyAvailabilityStatus;
      } catch { /* not applied yet */ }
      let holds: MyHold[] | null = null;
      if (status) {
        const { data: hs, error: hErr } = await db.from('consultant_holds')
          .select('id, starts_at, ends_at, status, reason, set_by_admin, admin_reason')
          .eq('consultant_id', c.id).in('status', ['scheduled', 'active']).order('starts_at');
        if (!hErr) holds = (hs ?? []) as MyHold[];
      }
      return {
        consultantId: c.id, userId: session.user.id, timezone: c.timezone || 'Asia/Riyadh', createdAt: c.created_at ?? null,
        availabilityStatus: c.availability_status ?? null,
        weekly: weeklyFromSlots(recurring), weeklySlotIds: recurring.map((s: { id: string }) => s.id), status, holds,
      };
    },
  });
}

/** The current hold (time-based) and the next scheduled one. */
export function currentHolds(holds: MyHold[] | null | undefined, now = Date.now()): { active: MyHold | null; next: MyHold | null } {
  const open = (holds ?? []).filter((h) => holdState(h, now) === 'active' || holdState(h, now) === 'scheduled');
  return {
    active: open.find((h) => holdState(h, now) === 'active') ?? null,
    next: open.filter((h) => holdState(h, now) === 'scheduled').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null,
  };
}

export function useAvailabilityActions() {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: MY_AVAILABILITY_KEY }),
      qc.invalidateQueries({ queryKey: ['my-availability-slots'] }),
      qc.invalidateQueries({ queryKey: ['my-consultant-availability'] }),
      qc.invalidateQueries({ queryKey: ['my-missing-profile-fields'] }),
      qc.invalidateQueries({ queryKey: ['getting-started'] }),
      qc.invalidateQueries({ queryKey: ['consultant-dashboard'] }),
    ]);
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
    await refresh();
    return data;
  };
  return {
    /** Replaces the recurring weekly slots (one-date slots stay) and saves the time zone and the matching working week. */
    saveWeekly: async (me: MyAvailability, list: WeeklyInterval[], timezone: string) => {
      const next = sortIntervals(list);
      const insert = next.map((s) => ({ consultant_id: me.consultantId, day_of_week: s.day, start_time: s.start, end_time: s.end, is_recurring: true, specific_date: null }));
      // Insert first, then remove the old rows, so a failure never leaves the consultant with no availability.
      if (insert.length) {
        const { error } = await db.from('availability_slots').insert(insert);
        if (error) throw error;
      }
      if (me.weeklySlotIds.length) {
        const { error } = await db.from('availability_slots').delete().in('id', me.weeklySlotIds).eq('consultant_id', me.consultantId);
        if (error) throw error;
      }
      const patch: Record<string, unknown> = { timezone };
      const week = workingWeekFor(next);
      if (week) patch.working_week = week;
      const { error: cErr } = await db.from('consultants').update(patch).eq('id', me.consultantId);
      if (cErr) throw cErr;
      await refresh();
    },
    setHold: (startsAt: string | null, endsAt: string, reason: string | null) => rpc('set_my_hold', { _starts_at: startsAt, _ends_at: endsAt, _reason: reason }),
    changeHold: (id: string, endsAt: string) => rpc('change_my_hold', { _hold_id: id, _ends_at: endsAt }),
    resumeHold: () => rpc('resume_my_hold', {}),
    cancelHold: (id: string) => rpc('cancel_my_hold', { _hold_id: id }),
    refresh,
  };
}

export interface AvailabilityConfig { ready: boolean; holdDirectory: HoldDirectoryMode; holdMaxDays: number; required: boolean }

export function useAvailabilityConfig(): AvailabilityConfig {
  const { signedIn } = useSessionReady();
  const q = useQuery({
    queryKey: ['availability-public-config'],
    enabled: signedIn,
    staleTime: 15 * 60_000,
    retry: false,
    queryFn: async (): Promise<AvailabilityConfig> => {
      const { data, error } = await db.rpc('availability_public_config');
      if (error || !data) return { ready: false, holdDirectory: 'label', holdMaxDays: HOLD_MAX_DAYS_DEFAULT, required: true };
      return { ready: true, holdDirectory: parseHoldDirectoryMode(data.hold_directory), holdMaxDays: Number(data.hold_max_days) || HOLD_MAX_DAYS_DEFAULT, required: data.required !== false };
    },
  });
  return q.data ?? { ready: false, holdDirectory: 'label', holdMaxDays: HOLD_MAX_DAYS_DEFAULT, required: true };
}

/** "On hold until" for a list of consultants (only the end date; never the reason). Empty until the update is applied. */
export function useHoldsPublic(ids: string[]): Map<string, string> {
  const { signedIn } = useSessionReady();
  const key = [...ids].sort().join(',');
  const q = useQuery({
    queryKey: ['consultant-hold-public', key],
    enabled: signedIn && ids.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const out = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await db.rpc('consultant_hold_public', { _ids: ids.slice(i, i + 500) });
        if (error) break;
        for (const r of (data ?? []) as Array<{ consultant_id: string; ends_at: string }>) out.set(r.consultant_id, r.ends_at);
      }
      return out;
    },
  });
  return q.data ?? new Map();
}

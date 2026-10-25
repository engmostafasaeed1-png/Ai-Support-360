import { supabase } from '@/integrations/supabase/client';
import { reportError } from '@/lib/errorReporter';
import type { InviteResult, MeetingErrorCode } from '@/lib/meetingInvite';
import type { BusyInterval } from '@/lib/meetingSchedule';

export interface ScheduleMeetingInput {
  ticket_id: string;
  consultant_ids: string[];
  external_emails: string[];
  /** colleagues of the same company (client owner / admin only) */
  colleague_ids?: string[];
  session_type: string;
  platform: string;
  scheduled_at: string;
  duration_minutes: number;
  reminder_minutes: number;
  notes?: string;
  meeting_url?: string;
  lang: 'en' | 'ar';
}
export type ScheduleMeetingResult =
  | { ok: true; session_id: string; meeting_url: string; join_url: string; invitations: InviteResult[] }
  | { ok: false; code: MeetingErrorCode | string };

/** Calls the schedule-meeting function and turns every failure into a plain code (never "Failed to schedule meeting"). */
export async function scheduleMeeting(input: ScheduleMeetingInput): Promise<ScheduleMeetingResult> {
  let res: ScheduleMeetingResult;
  try {
    const { data, error } = await supabase.functions.invoke('schedule-meeting', { body: input });
    if (error) {
      let code = 'server_error';
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        try { const j = await ctx.clone().json(); if (j && typeof j.code === 'string') code = j.code; } catch { /* not JSON */ }
      } else if (/fetch|network/i.test(String((error as Error).message))) code = 'network';
      res = { ok: false, code };
    } else if (data && data.ok === true) {
      res = data as ScheduleMeetingResult;
    } else {
      res = { ok: false, code: (data && typeof data.code === 'string') ? data.code : 'server_error' };
    }
  } catch {
    res = { ok: false, code: 'network' };
  }
  // Logged once per attempt, without addresses or notes.
  if (!res.ok) {
    reportError({ level: 'warn', source: 'schedule-meeting', message: `Meeting not scheduled: ${res.code}`,
      context: { code: res.code, ticket_id: input.ticket_id, consultants: input.consultant_ids.length, external: input.external_emails.length, platform: input.platform } });
  } else if (res.invitations.some((r) => r.status === 'failed' || r.status === 'rate_limited')) {
    reportError({ level: 'warn', source: 'schedule-meeting', message: 'Meeting invitation e-mail not sent',
      context: { session_id: res.session_id, statuses: res.invitations.map((r) => r.status) } });
  }
  return res;
}

export interface MeetingOptions {
  external_allowed: boolean;
  can_invite_colleagues: boolean;
  colleagues: { user_id: string; name: string }[];
  busy: BusyInterval[];
  primary_consultant_id: string | null;
}
/** Defaults while the options are loading or when the call fails: nothing extra offered, the server still decides. */
export const DEFAULT_MEETING_OPTIONS: MeetingOptions = { external_allowed: true, can_invite_colleagues: false, colleagues: [], busy: [], primary_consultant_id: null };

/** What the dialog may offer for this ticket (external switch, colleagues, busy times for the conflict check). Never throws. */
export async function meetingOptions(ticketId: string): Promise<MeetingOptions> {
  try {
    const { data, error } = await supabase.functions.invoke('schedule-meeting', { body: { action: 'options', ticket_id: ticketId } });
    if (error || !data || data.ok !== true) return DEFAULT_MEETING_OPTIONS;
    return {
      external_allowed: data.external_allowed !== false,
      can_invite_colleagues: data.can_invite_colleagues === true,
      colleagues: Array.isArray(data.colleagues) ? data.colleagues : [],
      busy: Array.isArray(data.busy) ? data.busy : [],
      primary_consultant_id: typeof data.primary_consultant_id === 'string' ? data.primary_consultant_id : null,
    };
  } catch {
    return DEFAULT_MEETING_OPTIONS;
  }
}

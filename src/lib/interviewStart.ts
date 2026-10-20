import { supabase } from '@/integrations/supabase/client';
import { reportError } from '@/lib/errorReporter';

/** Why an AI interview cannot start right now. Every reason has a visible message and, where possible, the action that fixes it. */
export type StartBlockCode = 'checking' | 'signed_out' | 'no_profile' | 'missing_name' | 'missing_role';
export type StartErrorCode = 'network' | 'permission' | 'service';

export const BLOCK_TEXT: Record<StartBlockCode, { key: string; message: string; action?: { key: string; label: string; to: string } }> = {
  checking: { key: 'interview.block_checking', message: 'Checking your sign-in…' },
  signed_out: { key: 'interview.block_signed_out', message: 'Please sign in again to start the AI interview.', action: { key: 'interview.action_sign_in', label: 'Sign in', to: '/login' } },
  no_profile: { key: 'interview.block_no_profile', message: 'Save your consultant profile first.', action: { key: 'interview.action_open_profile', label: 'Open my profile', to: '/consultant/profile' } },
  missing_name: { key: 'interview.block_missing_name', message: 'Add your name first.', action: { key: 'interview.action_add_name', label: 'Add my name', to: '/consultant/profile#profile-details' } },
  missing_role: { key: 'interview.block_missing_role', message: 'Add your SAP role first.', action: { key: 'interview.action_add_role', label: 'Add my SAP role', to: '/consultant/profile#expertise' } },
};

export const ERROR_TEXT: Record<StartErrorCode, { key: string; message: string }> = {
  network: { key: 'interview.error_network', message: 'You seem to be offline. Check your internet connection and try again.' },
  permission: { key: 'interview.error_permission', message: 'Your account is not allowed to start an interview right now. Sign out and in again; if it continues, contact support.' },
  service: { key: 'interview.error_service', message: 'AI service temporarily unavailable - try again.' },
};

export interface EligibilityInput {
  ready: boolean;
  signedIn: boolean;
  consultantId: string | null | undefined;
  displayName: string | null | undefined;
  /** At least one SAP role (sap_roles / sap_role) or one SAP skill row. */
  hasSapRole: boolean;
}

/** The minimum to start: signed in, a consultant profile with a name and an SAP role or skill. Returns null when the consultant can start. */
export function startBlockReason(i: EligibilityInput): StartBlockCode | null {
  if (!i.ready) return 'checking';
  if (!i.signedIn) return 'signed_out';
  if (!i.consultantId) return 'no_profile';
  if (!i.displayName || !i.displayName.trim()) return 'missing_name';
  if (!i.hasSapRole) return 'missing_role';
  return null;
}

export interface SessionRow { id: string; status: string; created_at: string; interview_style?: string | null }
export type ResumeReason = 'in_progress' | 'pending' | 'stale_pending';
export const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

/**
 * Which existing AI session to continue instead of creating another one.
 * A started (in_progress) interview is resumed first; otherwise the newest never-started one is reused,
 * and one older than 24 hours is reused as well (counted as stale) so it never piles up into duplicates.
 * Live sessions with the team are never picked.
 */
export function pickSessionToResume(rows: SessionRow[], nowMs: number): { id: string; reason: ResumeReason } | null {
  const open = rows.filter(r => r.interview_style !== 'live' && (r.status === 'in_progress' || r.status === 'pending'));
  const newest = (list: SessionRow[]) => [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const started = newest(open.filter(r => r.status === 'in_progress'));
  if (started) return { id: started.id, reason: 'in_progress' };
  const pending = newest(open.filter(r => r.status === 'pending'));
  if (!pending) return null;
  return { id: pending.id, reason: nowMs - Date.parse(pending.created_at) > STALE_PENDING_MS ? 'stale_pending' : 'pending' };
}

export class InterviewStartError extends Error {
  constructor(public code: StartErrorCode, cause?: unknown) {
    super(ERROR_TEXT[code].message);
    this.name = 'InterviewStartError';
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

/** Maps a failure while finding or creating the session to a reason the consultant can act on. */
export function classifyStartError(err: unknown): StartErrorCode {
  if (err instanceof InterviewStartError) return err.code;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network';
  const e = (err ?? {}) as { code?: string; message?: string; status?: number; name?: string };
  const text = `${e.message ?? ''}`.toLowerCase();
  if (e.name === 'TypeError' && /fetch|network|load failed/.test(text)) return 'network';
  if (/failed to fetch|networkerror|network request failed|load failed/.test(text)) return 'network';
  if (e.code === '42501' || e.status === 401 || e.status === 403 || /permission denied|row-level security|not allowed|jwt/.test(text)) return 'permission';
  return 'service';
}

const logged = new Set<string>();
/** Logs a service or permission failure to the error reports once per page session; network drops are not logged. */
export function logStartErrorOnce(code: StartErrorCode, err: unknown, where: string): void {
  if (code === 'network') return;
  const key = `${where}:${code}`;
  if (logged.has(key)) return;
  logged.add(key);
  const e = (err ?? {}) as { message?: string; code?: string };
  reportError({ level: 'error', source: 'ai-interview-start', message: `AI interview could not start (${code}) at ${where}: ${e.message ?? 'unknown error'}`, context: { code: e.code ?? null, where } });
}
export function resetStartErrorLog(): void { logged.clear(); }

type Db = { from: (table: string) => any };
const inflight = new Map<string, Promise<{ id: string; resumed: ResumeReason | null }>>();

/**
 * Finds the consultant's open AI interview (resume / reuse) or creates exactly one new one.
 * Single-flight per consultant, so double clicks and several start buttons never create duplicates.
 */
export function resolveAiInterviewSession(consultantId: string, db: Db = supabase as unknown as Db, nowMs = Date.now()): Promise<{ id: string; resumed: ResumeReason | null }> {
  const running = inflight.get(consultantId);
  if (running) return running;
  const job = (async () => {
    const { data: rows, error } = await db.from('interview_sessions')
      .select('id, status, created_at, interview_style')
      .eq('consultant_id', consultantId).eq('interview_type', 'ai')
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    const pick = pickSessionToResume((rows || []) as SessionRow[], nowMs);
    if (pick) return { id: pick.id, resumed: pick.reason };
    const { data: created, error: insertError } = await db.from('interview_sessions')
      .insert({ consultant_id: consultantId, interview_type: 'ai', status: 'pending', interview_style: 'standard' })
      .select('id').single();
    if (insertError) throw insertError;
    return { id: (created as { id: string }).id, resumed: null };
  })();
  inflight.set(consultantId, job);
  const clear = () => { if (inflight.get(consultantId) === job) inflight.delete(consultantId); };
  job.then(clear, clear);
  return job;
}

// One quality record per submitted answer (engine used, fallback, edited or not). Best effort: never blocks or throws,
// and is silently skipped until docs/sql/interview-voice.sql is applied. No answer text is sent.
import { fireAndForget, safeRpc } from '@/lib/safeRpc';
import type { AnswerMeta } from '@/hooks/useVoiceRecognizer';
import type { VoiceContext } from './transcribeClient';

export interface AnswerLog {
  context: VoiceContext;
  interviewId?: string | null;
  /** Null when the answer was typed. */
  meta: AnswerMeta | null;
  /** The voice text was changed before sending. */
  edited: boolean;
  chars: number;
}

/** Arguments for the voice_log_answer database function (exported for tests). */
export function answerLogArgs(a: AnswerLog) {
  const engine = a.meta?.engine ?? 'typed';
  return {
    _interview_id: a.context === 'interview' ? a.interviewId ?? null : null,
    _context: a.context,
    _engine: engine,
    _fallback: engine === 'typed' ? null : a.meta?.fallback ?? null,
    _segments: Math.max(0, Math.min(500, a.meta?.segments ?? 0)),
    _edited: engine !== 'typed' && a.edited,
    _chars: Math.max(0, Math.min(20000, Math.round(a.chars))),
  };
}

export function logVoiceAnswer(a: AnswerLog): void {
  if (a.context === 'interview' && !a.interviewId) return;
  fireAndForget(() => safeRpc('voice_log_answer', answerLogArgs(a)));
}

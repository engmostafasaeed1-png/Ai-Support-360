// After each interview answer: tell the database what the consultant changed in the spoken text (learning loop,
// docs/sql/interview-voice-learning.sql). Only short word pairs that pass the privacy filter (no e-mails, phone numbers,
// links, long numbers, secrets, profanity or instructions) and per-model error counts are sent, never audio.
// Fire-and-forget: it never blocks or fails the interview, and does nothing until that SQL file is applied.
import { safeRpc } from '@/lib/safeRpc';
import { extractCorrectionPairs, scrubText, type CorrectionPair } from '../../../supabase/functions/_shared/voiceLearning';
import { wordErrors } from '../../../supabase/functions/_shared/voiceText';
import type { AnswerMeta } from '@/hooks/useVoiceRecognizer';

export interface LearnInput {
  interviewId: string | null | undefined;
  answerOrder: number;
  answerMs: number | null;
  /** Text the recognizer put in the box (empty when the answer was typed). */
  shown: string;
  /** Text the consultant actually sent. */
  final: string;
  meta: AnswerMeta | null;
  language: string;
  /** The box already held typed text when the microphone started, so raw model text is only part of the answer. */
  partialVoice?: boolean;
}

export interface LearnArgs {
  _interview_id: string; _answer_order: number; _answer_ms: number | null; _edited: boolean; _language: string; _device: string | null;
  _vocab_version: number | null; _models: Array<{ model: string; words: number; errors: number }>; _pairs: CorrectionPair[];
  _raw: string | null; _final: string | null; _engine: 'server' | 'webspeech' | 'typed';
}

/** Builds the database call (exported for tests). Returns null when there is nothing to record. */
export function learningArgs(i: LearnInput): LearnArgs | null {
  if (!i.interviewId || !i.final.trim() || i.answerOrder < 1) return null;
  const engine: LearnArgs['_engine'] = !i.meta || !i.shown.trim() ? 'typed' : i.meta.engine === 'server' ? 'server' : 'webspeech';
  const edited = engine !== 'typed' && i.shown.trim() !== i.final.trim();
  const server = engine === 'server';
  const pairs = server && edited ? extractCorrectionPairs(i.shown, i.final) : [];
  // Per-model errors against the sent answer only when the whole answer came from the microphone.
  const models = server && !i.partialVoice
    ? Object.entries(i.meta?.rawByModel ?? {}).slice(0, 3).flatMap(([model, raw]) => {
        const e = wordErrors(i.final, raw);
        return e.reference > 0 ? [{ model, words: e.reference, errors: e.substitutions + e.deletions + e.insertions }] : [];
      })
    : [];
  const mainRaw = server && !i.partialVoice && i.meta?.model ? i.meta.rawByModel?.[i.meta.model] ?? null : null;
  return {
    _interview_id: i.interviewId, _answer_order: i.answerOrder,
    _answer_ms: i.answerMs != null && i.answerMs >= 0 ? Math.min(Math.round(i.answerMs), 3_600_000) : null,
    _edited: edited, _language: (i.language || '').slice(0, 10), _device: i.meta?.device ?? null,
    _vocab_version: i.meta?.vocabVersion ?? null, _models: models, _pairs: pairs,
    _raw: mainRaw ? scrubText(mainRaw).slice(0, 4000) : null, _final: mainRaw ? scrubText(i.final).slice(0, 4000) : null,
    _engine: engine,
  };
}

export function learnFromAnswer(i: LearnInput): void {
  const args = learningArgs(i);
  if (!args) return;
  void safeRpc('voice_learn_from_answer', args as unknown as Record<string, unknown>);
}

// Interview voice (server speech-to-text) settings: platform_settings key `interview_voice` (docs/sql/interview-voice.sql).
// Pure (no Deno or browser APIs): used by the voice-transcribe function, the admin Voice panel and tests.
// The database claim function (voice_claim_segment) reads the same JSON and enforces the caps; this file only mirrors
// the defaults and limits for display and for the function's own checks.

export const VOICE_SETTINGS_KEY = "interview_voice";

/** Speech-to-text model on the AI gateway: multilingual, accepts keyword hints and several language hints in one call. */
export const VOICE_MODEL = "openai/gpt-transcribe";
/** Gateway price for VOICE_MODEL, in workspace credits per second of audio (model listing, 2026-10-24). */
export const VOICE_CREDITS_PER_SECOND = 0.0003;

export interface VoiceSettings {
  /** Use server transcription. Off: every microphone falls back to the browser's own recogniser. */
  server_stt: boolean;
  /** Keep a copy of interview audio in private storage for admin review. Default off: audio is never stored. */
  store_audio: boolean;
  /** Fix the spelling of SAP terms from the glossary after transcription (raw text is kept for audit). */
  post_correct: boolean;
  /** Audio minutes per interview at most. */
  max_minutes_interview: number;
  /** Audio minutes per user per day at most (interviews and dictation together). */
  max_minutes_day: number;
  /** Audio minutes per user per day for dictation outside interviews (ticket text, chat, proposals). */
  dictation_minutes_day: number;
  /** Longest single recording segment in seconds. */
  max_segment_seconds: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  server_stt: true,
  store_audio: false,
  post_correct: true,
  max_minutes_interview: 40,
  max_minutes_day: 90,
  dictation_minutes_day: 20,
  max_segment_seconds: 30,
};

export const VOICE_LIMITS = {
  max_minutes_interview: [5, 120],
  max_minutes_day: [10, 480],
  dictation_minutes_day: [0, 120],
  max_segment_seconds: [10, 30],
} as const;

/** Upload cap: 30 s of 16 kHz mono 16-bit WAV is about 0.96 MB; leave room for the header and form fields. */
export const VOICE_MAX_UPLOAD_BYTES = 1_200_000;
/** Recordings shorter than this are not sent to the model (nothing to transcribe, no cost). */
export const VOICE_MIN_SECONDS = 0.4;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], dflt: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof VoiceSettings) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (DEFAULT_VOICE_SETTINGS[k] as boolean));
  return {
    server_stt: bool("server_stt"),
    store_audio: bool("store_audio"),
    post_correct: bool("post_correct"),
    max_minutes_interview: clamp(o.max_minutes_interview, VOICE_LIMITS.max_minutes_interview, DEFAULT_VOICE_SETTINGS.max_minutes_interview),
    max_minutes_day: clamp(o.max_minutes_day, VOICE_LIMITS.max_minutes_day, DEFAULT_VOICE_SETTINGS.max_minutes_day),
    dictation_minutes_day: clamp(o.dictation_minutes_day, VOICE_LIMITS.dictation_minutes_day, DEFAULT_VOICE_SETTINGS.dictation_minutes_day),
    max_segment_seconds: clamp(o.max_segment_seconds, VOICE_LIMITS.max_segment_seconds, DEFAULT_VOICE_SETTINGS.max_segment_seconds),
  };
}

/** Credits for a number of audio seconds at the model's gateway price. */
export function voiceCredits(seconds: number): number {
  return Math.round(Math.max(0, seconds) * VOICE_CREDITS_PER_SECOND * 10000) / 10000;
}

/**
 * Language hints for the model, from the interview language setting. Every answer may mix the interview language with
 * English and Arabic, so both are always included (at most three codes).
 */
export function languageHints(lang: string | null | undefined): string[] {
  const primary = String(lang || "auto").toLowerCase().split(/[-_]/)[0];
  const out: string[] = [];
  const add = (c: string) => { if (/^[a-z]{2}$/.test(c) && !out.includes(c)) out.push(c); };
  if (primary !== "auto") add(primary);
  add("en");
  add("ar");
  return out.slice(0, 3);
}

// Tune the conversation cadence here; speech and typing share one send controller.
export const SPEECH_SILENCE_MS = 2500;
export const TYPING_IDLE_MS = 4000;
export const HEARING_WARNING_MS = 8000;
export const MIN_ANSWER_WORDS = 3;
export const answerWordCount = (text: string) => (text.match(/[\p{L}\p{N}]+(?:[/'’+-][\p{L}\p{N}]+)*/gu) ?? []).length;
export const canSendAnswer = (text: string) => answerWordCount(text) >= MIN_ANSWER_WORDS;
export const VOICE_LANGUAGE_KEY = 'interview-voice-language';
export function savedVoiceLanguage(fallback: string): string {
  try { const saved = localStorage.getItem(VOICE_LANGUAGE_KEY); return saved === 'en-US' || saved === 'ar-SA' ? saved : fallback.startsWith('ar') ? 'ar-SA' : 'en-US'; }
  catch { return fallback.startsWith('ar') ? 'ar-SA' : 'en-US'; }
}
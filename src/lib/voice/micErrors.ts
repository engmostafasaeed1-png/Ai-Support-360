// Turns browser microphone errors into one of a few plain cases, each with its own message (EN/AR in the locales).

export type MicProblem = 'permission' | 'device' | 'busy' | 'insecure' | 'unsupported' | 'unknown';

export function classifyMicError(e: unknown): MicProblem {
  const name = String((e as { name?: string } | null)?.name ?? '');
  const message = String((e as { message?: string } | null)?.message ?? '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' || /not-allowed|service-not-allowed/.test(message)) return 'permission';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'TypeError' && /secure|https/i.test(message)) return 'insecure';
  if (name === 'NotSupportedError' || /not supported/i.test(message)) return 'unsupported';
  return 'unknown';
}

/** Web Speech `error` event codes mapped to the same cases. */
export function classifyWebSpeechError(code: string): MicProblem | 'no-speech' | 'aborted' | 'network' {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'permission';
  if (code === 'audio-capture') return 'device';
  if (code === 'no-speech') return 'no-speech';
  if (code === 'aborted') return 'aborted';
  if (code === 'network') return 'network';
  if (code === 'language-not-supported') return 'unsupported';
  return 'unknown';
}

export const MIC_PROBLEM_TEXT: Record<MicProblem, { key: string; text: string }> = {
  permission: { key: 'voice.problem.permission', text: 'Microphone access is blocked. Click the microphone or lock icon in the address bar, allow the microphone, then press the microphone button again. You can also type your answer.' },
  device: { key: 'voice.problem.device', text: 'No microphone was found. Connect a microphone or headset, or choose another one in the microphone test. You can also type your answer.' },
  busy: { key: 'voice.problem.busy', text: 'Your microphone is being used by another app (for example a meeting app). Close it and try again, or type your answer.' },
  insecure: { key: 'voice.problem.insecure', text: 'Voice input needs a secure (https) page. Please open the site with https, or type your answer.' },
  unsupported: { key: 'voice.problem.unsupported', text: 'This browser cannot record your voice. Please use a current Chrome, Edge or Safari, or type your answer.' },
  unknown: { key: 'voice.problem.unknown', text: 'The microphone could not start. Please try again, or type your answer.' },
};

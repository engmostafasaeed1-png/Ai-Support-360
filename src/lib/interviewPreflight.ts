/** Device and browser checks shown before the AI interview starts. Nothing here blocks the text-only interview except being offline. */
export type CheckState = 'ok' | 'warn' | 'fail' | 'unknown';
export interface PreflightResult {
  network: CheckState;
  browser: CheckState;
  voice: CheckState;
  camera: CheckState;
  microphone: CheckState;
}

type Env = {
  onLine?: boolean;
  hasMediaDevices: boolean;
  hasSpeechRecognition: boolean;
  hasSpeechSynthesis: boolean;
  secure: boolean;
};

export function readEnv(): Env {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    onLine: nav?.onLine,
    hasMediaDevices: !!nav?.mediaDevices?.getUserMedia,
    hasSpeechRecognition: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
    hasSpeechSynthesis: !!w.speechSynthesis,
    secure: typeof window === 'undefined' ? true : window.isSecureContext !== false,
  };
}

/** The checks that need no permission prompt. Camera and microphone stay unknown until tested or already granted. */
export function basicChecks(env: Env): PreflightResult {
  return {
    network: env.onLine === false ? 'fail' : 'ok',
    browser: env.hasMediaDevices && env.secure ? 'ok' : 'warn',
    voice: env.hasSpeechRecognition && env.hasSpeechSynthesis ? 'ok' : 'warn',
    camera: env.hasMediaDevices ? 'unknown' : 'warn',
    microphone: env.hasMediaDevices ? 'unknown' : 'warn',
  };
}

/** Maps a browser permission state ("granted", "denied", "prompt") to a check state. */
export function permissionToCheck(state: string | undefined): CheckState {
  if (state === 'granted') return 'ok';
  if (state === 'denied') return 'fail';
  return 'unknown';
}

/** Only being offline blocks the start; every device problem falls back to typing. */
export function canStart(r: PreflightResult): boolean {
  return r.network !== 'fail';
}

/** Asks the browser for camera and microphone once and immediately releases them. */
export async function testDevices(): Promise<{ camera: CheckState; microphone: CheckState; error?: string }> {
  if (!navigator.mediaDevices?.getUserMedia) return { camera: 'warn', microphone: 'warn', error: 'unsupported' };
  const ask = async (constraints: MediaStreamConstraints): Promise<{ state: CheckState; error?: string }> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(t => t.stop());
      return { state: 'ok' };
    } catch (e) {
      const name = (e as { name?: string })?.name;
      return { state: name === 'NotFoundError' ? 'warn' : 'fail', error: name };
    }
  };
  const mic = await ask({ audio: true });
  const cam = await ask({ video: true });
  return { camera: cam.state, microphone: mic.state, error: cam.error || mic.error };
}

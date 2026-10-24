// Talks to the voice-transcribe backend function. Never throws for "server not available": the caller then uses the
// browser's own recogniser. Retries only rate limits and temporary server errors, a bounded number of times.
import { supabase } from '@/integrations/supabase/client';

const URL_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-transcribe`;

export type VoiceContext = 'interview' | 'dictation';
/** Why the browser recogniser is used instead of the server (stored with each answer for the admin metrics). */
export type FallbackReason = 'server_failed' | 'rate_limited' | 'quota' | 'disabled' | 'not_ready' | 'unsupported' | 'permission' | 'device';

export interface ServerVoiceStatus { ready: boolean; reason: FallbackReason | null; maxSegmentSeconds: number }
export interface TranscribeResult { text: string; rawText: string; language: string | null; seconds: number; corrections: number; latencyMs: number }

export class VoiceServerError extends Error {
  constructor(public code: string, public status: number, public retryAfterMs: number | null) { super(code); }
  /** Errors after which this answer should switch to the browser recogniser instead of retrying. */
  get terminal(): boolean {
    return ['interview_cap', 'day_cap', 'dictation_cap', 'quota', 'disabled', 'not_ready', 'credits', 'provider_denied', 'unauthorized', 'forbidden', 'closed', 'config'].includes(this.code);
  }
  get fallback(): FallbackReason {
    if (['interview_cap', 'day_cap', 'dictation_cap', 'quota', 'credits'].includes(this.code)) return 'quota';
    if (this.code === 'rate_limited') return 'rate_limited';
    if (this.code === 'disabled') return 'disabled';
    if (this.code === 'not_ready') return 'not_ready';
    return 'server_failed';
  }
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
}

let probeCache: { at: number; value: Promise<ServerVoiceStatus> } | null = null;
const PROBE_TTL_MS = 5 * 60 * 1000;

/** Is server transcription available for this signed-in user right now? Cached for five minutes. */
export function probeServerVoice(force = false): Promise<ServerVoiceStatus> {
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.value;
  const value = (async (): Promise<ServerVoiceStatus> => {
    try {
      const headers = await authHeaders();
      if (!headers) return { ready: false, reason: 'not_ready', maxSegmentSeconds: 30 };
      const resp = await fetch(`${URL_BASE}?probe=1`, { method: 'GET', headers });
      if (!resp.ok) return { ready: false, reason: 'not_ready', maxSegmentSeconds: 30 };
      const body = await resp.json();
      const reason = body?.reason === 'disabled' ? 'disabled' : body?.ready ? null : 'not_ready';
      const max = Number(body?.max_segment_seconds);
      return { ready: body?.ready === true, reason, maxSegmentSeconds: Number.isFinite(max) && max >= 10 && max <= 30 ? max : 30 };
    } catch {
      return { ready: false, reason: 'not_ready', maxSegmentSeconds: 30 };
    }
  })();
  probeCache = { at: Date.now(), value };
  return value;
}

/** For tests and after an admin changes the setting. */
export function resetVoiceProbe(): void { probeCache = null; }

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Retry wait for attempt n (0-based): honours Retry-After up to 6 s, else 0.8 s, 1.6 s with jitter. */
export function retryDelayMs(attempt: number, retryAfterMs: number | null, random = Math.random): number {
  if (retryAfterMs != null && retryAfterMs >= 0) return Math.min(retryAfterMs, 6000);
  return Math.round(800 * 2 ** attempt * (0.8 + random() * 0.4));
}

/** Whether a failed upload may be sent again (only rate limits and temporary server errors). */
export function isRetryable(status: number, code: string): boolean {
  if (['interview_cap', 'day_cap', 'dictation_cap', 'quota'].includes(code)) return false;
  return status === 429 || status >= 500;
}

export const MAX_RETRIES = 2;

export async function transcribeSegment(args: {
  wav: Uint8Array; context: VoiceContext; interviewId?: string | null; segment: number; lang?: string; signal?: AbortSignal;
}): Promise<TranscribeResult> {
  let lastError: VoiceServerError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const headers = await authHeaders();
    if (!headers) throw new VoiceServerError('unauthorized', 401, null);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(args.wav)], { type: 'audio/wav' }), `segment-${args.segment}.wav`);
    form.append('context', args.context);
    if (args.interviewId) form.append('interview_id', args.interviewId);
    form.append('segment', String(args.segment));
    if (args.lang) form.append('lang', args.lang);
    let resp: Response;
    try {
      resp = await fetch(URL_BASE, { method: 'POST', headers, body: form, signal: args.signal });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      lastError = new VoiceServerError('network', 0, null);
      if (attempt < MAX_RETRIES) { await sleep(retryDelayMs(attempt, null), args.signal); continue; }
      throw lastError;
    }
    if (resp.ok) {
      const b = await resp.json();
      return {
        text: String(b?.text ?? ''), rawText: String(b?.raw_text ?? b?.text ?? ''), language: typeof b?.language === 'string' ? b.language : null,
        seconds: Number(b?.seconds) || 0, corrections: Number(b?.corrections) || 0, latencyMs: Number(b?.latency_ms) || 0,
      };
    }
    let code = 'server_error';
    try { const b = await resp.json(); if (typeof b?.code === 'string') code = b.code; } catch { /* no body */ }
    const ra = Number(resp.headers.get('Retry-After'));
    lastError = new VoiceServerError(code, resp.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : null);
    if (!isRetryable(resp.status, code) || attempt >= MAX_RETRIES) throw lastError;
    await sleep(retryDelayMs(attempt, lastError.retryAfterMs), args.signal);
  }
  throw lastError ?? new VoiceServerError('server_error', 500, null);
}

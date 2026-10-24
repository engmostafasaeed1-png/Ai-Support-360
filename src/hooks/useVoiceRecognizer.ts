// One speech recogniser for every microphone in the app (AI interview, live interview, ticket text, chat, proposals).
//
// Server engine (preferred): the microphone is recorded into short WAV segments that are transcribed by the
// voice-transcribe backend function with SAP vocabulary hints; segments are sent while the person keeps talking and
// put back in spoken order. Browser engine (fallback): the browser's own recogniser, used automatically when the server
// is not available, the daily voice limit is reached, or the server fails during an answer. Either way the text is
// only placed in the answer box; the person can edit it before it is sent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { canRecordAudio, savedMicDevice, startMicRecorder, type MicRecorder } from '@/lib/voice/micRecorder';
import { hasWebSpeech, startWebSpeech, type WebSpeechHandle } from '@/lib/voice/webSpeech';
import { classifyMicError, MIC_PROBLEM_TEXT, type MicProblem } from '@/lib/voice/micErrors';
import { joinText, TranscriptAssembler } from '@/lib/voice/transcriptAssembler';
import { probeServerVoice, transcribeSegment, VoiceServerError, type FallbackReason, type VoiceContext } from '@/lib/voice/transcribeClient';

export type VoiceStatus = 'idle' | 'starting' | 'listening' | 'paused' | 'error';
export type VoiceEngine = 'server' | 'webspeech';
export interface VoiceNotice { key: string; text: string }

export const VOICE_NOTICES = {
  switched: { key: 'voice.notice.switched', text: "Voice transcription is busy right now, so your browser's own speech recognition is used for this answer. Please check the text before sending." },
  quota: { key: 'voice.notice.quota', text: "You have reached the voice limit for now, so your browser's own speech recognition is used. Please check the text before sending." },
  segment_failed: { key: 'voice.notice.segment_failed', text: 'A part of your answer could not be transcribed. Please check the text and repeat or type anything missing.' },
  network: { key: 'voice.notice.network', text: 'Speech recognition lost its connection. Please check your internet and press the microphone again, or type your answer.' },
} as const;

export interface VoiceOptions {
  context: VoiceContext;
  interviewId?: string | null;
  /** Interview language ("en", "ar", "ar-SA"...), a picker language ("en-US", "ar-SA") or "auto" for mixed speech. */
  lang: string;
  /** Hands-free: call onIdle after this much silence once everything said has been transcribed (0 = never). */
  idleMs?: number;
  /** Text heard since start() (cumulative, in spoken order). */
  onText?: (text: string) => void;
  onIdle?: (text: string) => void;
}

export interface AnswerMeta { engine: VoiceEngine | null; fallback: FallbackReason | null; segments: number }

export function useVoiceRecognizer(options: VoiceOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [pending, setPending] = useState(0);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<VoiceNotice | null>(null);
  const [fallback, setFallback] = useState<FallbackReason | null>(null);

  const session = useRef(0);
  const rec = useRef<MicRecorder | null>(null);
  const web = useRef<WebSpeechHandle | null>(null);
  const asm = useRef(new TranscriptAssembler());
  const webText = useRef('');
  const quiet = useRef(0);
  const heard = useRef(false);
  const idleFired = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const engineRef = useRef<VoiceEngine | null>(null);
  const fallbackRef = useRef<FallbackReason | null>(null);
  const segments = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const lastLevelAt = useRef(0);

  const supported = canRecordAudio() || hasWebSpeech();

  const current = () => joinText(asm.current.text, webText.current);
  const emit = () => {
    const t = current();
    setText(t);
    optsRef.current.onText?.(t);
  };
  const setFallbackReason = (r: FallbackReason | null) => { fallbackRef.current = r; setFallback(r); };

  const fireIdle = useCallback((sid: number) => {
    if (sid !== session.current || idleFired.current) return;
    const t = current();
    if (!t) return;
    idleFired.current = true;
    optsRef.current.onIdle?.(t);
  }, []);

  const maybeIdle = useCallback((sid: number) => {
    const idleMs = optsRef.current.idleMs ?? 0;
    if (!idleMs || engineRef.current !== 'server' || sid !== session.current) return;
    if (heard.current && quiet.current >= idleMs && asm.current.pending === 0) fireIdle(sid);
  }, [fireIdle]);

  const startWeb = useCallback((sid: number): boolean => {
    const handle = startWebSpeech({
      lang: optsRef.current.lang,
      onFinal: (chunk) => {
        if (sid !== session.current) return;
        webText.current = joinText(webText.current, chunk);
        setInterim('');
        emit();
        const idleMs = optsRef.current.idleMs ?? 0;
        if (idleMs) {
          clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => fireIdle(sid), Math.max(1200, idleMs - 600));
        }
      },
      onInterim: (t) => {
        if (sid !== session.current) return;
        setInterim(t);
        if (t) clearTimeout(idleTimer.current);
      },
      onProblem: (p) => {
        if (sid !== session.current) return;
        if (p === 'network') { setNotice(VOICE_NOTICES.network); return; }
        setNotice(MIC_PROBLEM_TEXT[p]);
        if (p === 'permission' || p === 'device') setFallbackReason(p);
        web.current = null;
        setStatus('error');
        setLevel(0);
      },
    });
    if (!handle) return false;
    web.current = handle;
    engineRef.current = 'webspeech';
    setEngine('webspeech');
    setStatus('listening');
    return true;
  }, [fireIdle]);

  const upload = useCallback((sid: number, wav: Uint8Array) => {
    const index = asm.current.open();
    segments.current += 1;
    setPending(asm.current.pending);
    const o = optsRef.current;
    transcribeSegment({ wav, context: o.context, interviewId: o.interviewId, segment: index, lang: o.lang, signal: abort.current?.signal })
      .then((r) => {
        if (sid !== session.current) return;
        asm.current.resolve(index, r.text, r.rawText);
        emit();
      })
      .catch((e: unknown) => {
        if (sid !== session.current) return;
        asm.current.fail(index);
        if ((e as Error)?.name === 'AbortError') return;
        const err = e instanceof VoiceServerError ? e : new VoiceServerError('network', 0, null);
        setFallbackReason(err.fallback);
        if (err.terminal && rec.current) {
          // Keep listening with the browser's recogniser for the rest of this answer.
          rec.current.stop();
          rec.current = null;
          setNotice(err.fallback === 'quota' ? VOICE_NOTICES.quota : VOICE_NOTICES.switched);
          if (!startWeb(sid)) { setStatus('error'); setNotice(VOICE_NOTICES.segment_failed); }
        } else {
          setNotice(VOICE_NOTICES.segment_failed);
        }
      })
      .finally(() => {
        if (sid !== session.current) return;
        setPending(asm.current.pending);
        maybeIdle(sid);
      });
  }, [maybeIdle, startWeb]);

  const teardown = () => {
    clearTimeout(idleTimer.current);
    rec.current?.stop();
    rec.current = null;
    web.current?.stop();
    web.current = null;
    setLevel(0);
    setInterim('');
  };

  const start = useCallback(async () => {
    if (rec.current || web.current) return;
    const sid = ++session.current;
    abort.current?.abort();
    abort.current = new AbortController();
    asm.current = new TranscriptAssembler();
    webText.current = '';
    quiet.current = 0;
    heard.current = false;
    idleFired.current = false;
    segments.current = 0;
    engineRef.current = null;
    setText('');
    setInterim('');
    setPending(0);
    setNotice(null);
    setFallbackReason(null);
    setStatus('starting');

    const canRecord = canRecordAudio();
    const server = canRecord ? await probeServerVoice() : { ready: false, reason: 'unsupported' as FallbackReason, maxSegmentSeconds: 30 };
    if (sid !== session.current) return;
    if (server.ready) {
      try {
        const r = await startMicRecorder({
          deviceId: savedMicDevice(),
          maxSegmentSeconds: server.maxSegmentSeconds,
          onLevel: (l) => {
            const now = performance.now();
            if (now - lastLevelAt.current > 80) { lastLevelAt.current = now; setLevel(l); }
          },
          onSpeechStart: () => { heard.current = true; quiet.current = 0; },
          onSegment: (wav) => upload(sid, wav),
          onQuiet: (q, h) => { quiet.current = q; heard.current = heard.current || h; maybeIdle(sid); },
        });
        if (sid !== session.current) { r.stop(); return; }
        rec.current = r;
        engineRef.current = 'server';
        setEngine('server');
        setStatus('listening');
        return;
      } catch (e) {
        if (sid !== session.current) return;
        const p: MicProblem = classifyMicError(e);
        if (p === 'permission' || p === 'device' || p === 'busy') {
          setNotice(MIC_PROBLEM_TEXT[p]);
          setFallbackReason(p === 'busy' ? 'device' : p);
          setStatus('error');
          return;
        }
        setFallbackReason('server_failed');
      }
    } else {
      setFallbackReason(server.reason ?? 'unsupported');
    }
    if (!startWeb(sid)) {
      setNotice(MIC_PROBLEM_TEXT.unsupported);
      setFallbackReason('unsupported');
      setStatus('error');
    }
  }, [maybeIdle, startWeb, upload]);

  /** Stops listening; resolves with the full text once the last segments are back (at most 15 s). */
  const stop = useCallback(async (): Promise<string> => {
    const sid = session.current;
    teardown();
    setStatus('idle');
    const until = Date.now() + 15000;
    while (asm.current.pending > 0 && Date.now() < until && sid === session.current) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return current();
  }, []);

  /** Stops and throws away anything still on its way (e.g. the answer was sent by typing). */
  const cancel = useCallback(() => {
    session.current += 1;
    abort.current?.abort();
    teardown();
    setPending(0);
    setStatus('idle');
  }, []);

  /** While the AI interviewer speaks: keep the microphone open but record nothing. */
  const pause = useCallback(() => {
    if (rec.current) { rec.current.pause(); setStatus('paused'); setLevel(0); }
    else if (web.current) { web.current.stop(); web.current = null; setStatus('paused'); setInterim(''); }
  }, []);

  const resume = useCallback(() => {
    if (rec.current?.paused) { rec.current.resume(); setStatus('listening'); return; }
    if (engineRef.current === 'webspeech' && !web.current && status === 'paused') startWeb(session.current);
  }, [startWeb, status]);

  const answerMeta = useCallback((): AnswerMeta => ({ engine: engineRef.current, fallback: fallbackRef.current, segments: segments.current }), []);

  useEffect(() => () => { session.current += 1; abort.current?.abort(); clearTimeout(idleTimer.current); rec.current?.stop(); web.current?.stop(); }, []);

  return {
    supported, status, engine, level, interim, pending, text, notice, fallback,
    listening: status === 'listening' || status === 'paused' || status === 'starting',
    start, stop, cancel, pause, resume, answerMeta,
    clearNotice: () => setNotice(null),
  };
}

export type VoiceRecognizer = ReturnType<typeof useVoiceRecognizer>;

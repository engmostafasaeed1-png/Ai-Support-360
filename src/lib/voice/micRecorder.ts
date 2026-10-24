// Records the microphone into complete 16 kHz mono WAV segments, cut at natural pauses (see segmenter.ts).
// Echo cancellation, noise suppression and automatic gain are requested from the browser; while paused (the AI
// interviewer is speaking) no audio is kept at all, so the interviewer's voice is never transcribed as the answer.
import { Segmenter } from './segmenter';
import { concatFrames, downsample, encodeWav, meterLevel, rms, TARGET_RATE } from './wav';

const DEVICE_KEY = 'voice.deviceId';
const PRE_ROLL_MS = 300;
const KEEP_TAIL_MS = 250;
const MIN_SECONDS = 0.4;

export function savedMicDevice(): string | undefined {
  try { return localStorage.getItem(DEVICE_KEY) || undefined; } catch { return undefined; }
}
export function saveMicDevice(id: string | null): void {
  try { if (id) localStorage.setItem(DEVICE_KEY, id); else localStorage.removeItem(DEVICE_KEY); } catch { /* private mode */ }
}

export function canRecordAudio(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return !!navigator.mediaDevices?.getUserMedia && !!(w.AudioContext || w.webkitAudioContext) && window.isSecureContext !== false;
}

export function micConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  };
}

export interface MicRecorderOptions {
  deviceId?: string;
  maxSegmentSeconds?: number;
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  onSegment: (wav: Uint8Array, seconds: number) => void;
  /** Silence since the speaker last spoke (ms), and whether anything was said yet. */
  onQuiet?: (quietMs: number, heardSpeech: boolean) => void;
}

export interface MicRecorder {
  stop: () => void;
  pause: () => void;
  resume: () => void;
  readonly paused: boolean;
}

export async function startMicRecorder(o: MicRecorderOptions): Promise<MicRecorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(o.deviceId));
  } catch (e) {
    // A saved headset that is no longer plugged in: try the default microphone once.
    if (o.deviceId && (e as { name?: string })?.name === 'OverconstrainedError') {
      saveMicDevice(null);
      stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    } else throw e;
  }
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
    await ctx.resume();
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const rate = ctx.sampleRate;
  const frameMs = (2048 / rate) * 1000;
  const maxMs = Math.max(8, Math.min(30, o.maxSegmentSeconds ?? 30) - 1.5) * 1000;
  let seg = new Segmenter({ maxSegmentMs: maxMs });
  let preRoll: Float32Array[] = [];
  let frames: Float32Array[] = [];
  let paused = false;
  let stopped = false;

  const flush = (trimTailMs: number) => {
    let list = frames;
    frames = [];
    if (trimTailMs > 0) {
      const drop = Math.floor(trimTailMs / frameMs);
      if (drop > 0 && drop < list.length) list = list.slice(0, list.length - drop);
    }
    if (!list.length) return;
    const samples = downsample(concatFrames(list), rate, TARGET_RATE);
    const seconds = samples.length / TARGET_RATE;
    if (seconds < MIN_SECONDS) return;
    o.onSegment(encodeWav(samples, TARGET_RATE), Math.round(seconds * 100) / 100);
  };

  node.onaudioprocess = (event) => {
    if (stopped) return;
    if (paused) { o.onLevel?.(0); return; }
    const frame = new Float32Array(event.inputBuffer.getChannelData(0));
    const level = rms(frame);
    o.onLevel?.(meterLevel(level));
    const wasSpeaking = seg.inSpeech;
    const ev = seg.feed(level, frameMs);
    if (ev?.type === 'speech_start') {
      frames = [...preRoll, frame];
      preRoll = [];
      o.onSpeechStart?.();
    } else if (wasSpeaking) {
      frames.push(frame);
      if (ev?.type === 'cut') flush(ev.reason === 'pause' ? Math.max(0, seg.pauseMs - KEEP_TAIL_MS) : 0);
    } else {
      preRoll.push(frame);
      const keep = Math.ceil(PRE_ROLL_MS / frameMs);
      if (preRoll.length > keep) preRoll = preRoll.slice(-keep);
    }
    if (!seg.inSpeech) o.onQuiet?.(seg.quietMs, seg.heardSpeech);
  };
  source.connect(node);
  node.connect(ctx.destination); // the processor writes silence: nothing is played back

  const release = () => {
    try { node.disconnect(); source.disconnect(); } catch { /* already */ }
    node.onaudioprocess = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };

  return {
    stop() {
      if (stopped) return;
      if (seg.inSpeech) flush(0);
      stopped = true;
      release();
    },
    pause() {
      if (paused || stopped) return;
      if (seg.inSpeech) flush(0);
      paused = true;
      frames = [];
      preRoll = [];
      const heard = seg.heardSpeech;
      seg = new Segmenter({ maxSegmentMs: maxMs });
      seg.heardSpeech = heard;
    },
    resume() {
      if (!paused || stopped) return;
      paused = false;
    },
    get paused() { return paused; },
  };
}

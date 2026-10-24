import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: vi.fn() } }));

import { concatFrames, downsample, encodeWav, meterLevel, rms } from './wav';
import { Segmenter } from './segmenter';
import { joinText, TranscriptAssembler } from './transcriptAssembler';
import { isRetryable, MAX_RETRIES, retryDelayMs, VoiceServerError } from './transcribeClient';
import { classifyMicError, classifyWebSpeechError } from './micErrors';
import { answerLogArgs } from './voiceMetrics';
import { toSpeechLang } from './webSpeech';
import { basicChecks } from '@/lib/interviewPreflight';

describe('recording format', () => {
  it('downsamples 48 kHz to 16 kHz and writes a 44-byte WAV header', () => {
    const one = downsample(new Float32Array(48000).fill(0.5), 48000);
    expect(one.length).toBe(16000);
    expect(one[100]).toBeCloseTo(0.5);
    const wav = encodeWav(one);
    expect(wav.length).toBe(44 + 16000 * 2);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
  });
  it('joins frames and measures loudness', () => {
    expect(concatFrames([new Float32Array(3), new Float32Array(2)]).length).toBe(5);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(0.3)).toBeGreaterThan(meterLevel(0.01));
  });
});

describe('segment cutting', () => {
  const frame = 40;
  const run = (seg: Segmenter, level: number, ms: number) => {
    const events = [];
    for (let t = 0; t < ms; t += frame) { const e = seg.feed(level, frame); if (e) events.push(e); }
    return events;
  };
  it('ignores a short click', () => {
    const seg = new Segmenter();
    expect(run(seg, 0.2, 120)).toEqual([]);
    expect(run(seg, 0.001, 400)).toEqual([]);
  });
  it('starts on speech and cuts at a natural pause', () => {
    const seg = new Segmenter();
    run(seg, 0.001, 400);
    expect(run(seg, 0.2, 1000)).toEqual([{ type: 'speech_start' }]);
    expect(run(seg, 0.001, 800)).toEqual([{ type: 'cut', reason: 'pause' }]);
    expect(seg.heardSpeech).toBe(true);
    expect(seg.quietMs).toBeGreaterThanOrEqual(750);
  });
  it('cuts long speech before the maximum segment length', () => {
    const seg = new Segmenter({ maxSegmentMs: 28000 });
    const events = run(seg, 0.2, 30000);
    expect(events).toContainEqual({ type: 'cut', reason: 'max' });
  });
  it('a short thinking pause does not cut the segment', () => {
    const seg = new Segmenter();
    run(seg, 0.2, 1000);
    expect(run(seg, 0.001, 400)).toEqual([]);
    expect(seg.inSpeech).toBe(true);
  });
});

describe('ordered transcript', () => {
  it('keeps spoken order when answers come back out of order', () => {
    const a = new TranscriptAssembler();
    const first = a.open();
    const second = a.open();
    a.resolve(second, 'and checked ACDOCA');
    expect(a.pending).toBe(1);
    a.resolve(first, 'I posted in MIRO');
    expect(a.text).toBe('I posted in MIRO and checked ACDOCA');
    expect(a.pending).toBe(0);
  });
  it('a failed piece leaves the rest', () => {
    const a = new TranscriptAssembler();
    const i = a.open(); const j = a.open();
    a.fail(i); a.resolve(j, 'rest');
    expect(a.text).toBe('rest');
    expect(a.failed).toBe(1);
    expect(joinText('  a ', '', null, 'b  c')).toBe('a b c');
  });
});

describe('server errors and retries', () => {
  it('retries only rate limits and temporary server errors, at most twice', () => {
    expect(MAX_RETRIES).toBe(2);
    expect(isRetryable(429, 'rate_limited')).toBe(true);
    expect(isRetryable(502, 'provider_error')).toBe(true);
    expect(isRetryable(429, 'day_cap')).toBe(false);
    expect(isRetryable(400, 'bad_audio')).toBe(false);
    expect(isRetryable(403, 'provider_denied')).toBe(false);
  });
  it('honours Retry-After up to 6 seconds, otherwise backs off', () => {
    expect(retryDelayMs(0, 20000)).toBe(6000);
    expect(retryDelayMs(0, null, () => 0.5)).toBe(800);
    expect(retryDelayMs(1, null, () => 0.5)).toBe(1600);
  });
  it('switches to the browser recogniser after a limit or a denial', () => {
    expect(new VoiceServerError('day_cap', 429, null).terminal).toBe(true);
    expect(new VoiceServerError('day_cap', 429, null).fallback).toBe('quota');
    expect(new VoiceServerError('provider_denied', 403, null).terminal).toBe(true);
    expect(new VoiceServerError('provider_error', 502, null).terminal).toBe(false);
  });
});

describe('microphone problems', () => {
  it('maps browser errors to plain cases', () => {
    expect(classifyMicError({ name: 'NotAllowedError' })).toBe('permission');
    expect(classifyMicError({ name: 'NotFoundError' })).toBe('device');
    expect(classifyMicError({ name: 'NotReadableError' })).toBe('busy');
    expect(classifyWebSpeechError('audio-capture')).toBe('device');
    expect(classifyWebSpeechError('no-speech')).toBe('no-speech');
  });
  it('uses Egyptian Arabic for "ar" and Saudi for "ar-SA"', () => {
    expect(toSpeechLang('ar')).toBe('ar-EG');
    expect(toSpeechLang('ar-SA')).toBe('ar-SA');
    expect(toSpeechLang('en')).toBe('en-US');
  });
});

describe('answer quality record', () => {
  it('a typed answer has no fallback and is never "edited"', () => {
    expect(answerLogArgs({ context: 'interview', interviewId: 'i', meta: null, edited: true, chars: 10 })).toMatchObject({ _engine: 'typed', _fallback: null, _edited: false, _interview_id: 'i' });
  });
  it('dictation never carries an interview id', () => {
    expect(answerLogArgs({ context: 'dictation', interviewId: 'i', meta: { engine: 'server', fallback: null, segments: 2 }, edited: false, chars: 5 })._interview_id).toBeNull();
  });
  it('records the fallback reason of a voice answer', () => {
    expect(answerLogArgs({ context: 'interview', interviewId: 'i', meta: { engine: 'webspeech', fallback: 'quota', segments: 0 }, edited: true, chars: 3 })).toMatchObject({ _engine: 'webspeech', _fallback: 'quota', _edited: true });
  });
});

describe('pre-interview voice check', () => {
  it('voice works with recorded audio even without the browser recogniser (Firefox)', () => {
    const base = { onLine: true, hasMediaDevices: true, hasSpeechSynthesis: true, secure: true };
    expect(basicChecks({ ...base, hasSpeechRecognition: false, hasAudioRecording: true }).voice).toBe('ok');
    expect(basicChecks({ ...base, hasSpeechRecognition: false, hasAudioRecording: false }).voice).toBe('warn');
  });
});

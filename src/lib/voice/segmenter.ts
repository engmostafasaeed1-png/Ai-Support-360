// Decides where to cut the microphone stream into segments for server transcription. Pure (unit-tested).
//
// A segment starts when speech is heard (with a short pre-roll so the first syllable is kept) and ends at a natural
// pause or just before the maximum segment length. Cutting at a pause never ends the answer: the answer only ends when
// the speaker stops for the longer "idle" time and every segment has come back (see useVoiceRecognizer), so thinking
// pauses in the middle of an answer are safe.

export interface SegmenterOptions {
  /** Silence that ends a segment (ms). */
  pauseMs?: number;
  /** Speech needed before a segment starts (ms), so coughs and clicks are ignored. */
  minSpeechMs?: number;
  /** Longest segment (ms); a segment is cut here even mid-sentence. */
  maxSegmentMs?: number;
  /** Lowest loudness counted as speech. */
  minThreshold?: number;
}

export type SegmenterEvent = { type: 'speech_start' } | { type: 'cut'; reason: 'pause' | 'max' } | null;

export class Segmenter {
  readonly pauseMs: number;
  readonly minSpeechMs: number;
  readonly maxSegmentMs: number;
  readonly minThreshold: number;
  noiseFloor = 0.004;
  inSpeech = false;
  voicedMs = 0;
  silentMs = 0;
  segmentMs = 0;
  /** Silence since the last speech, across segment cuts (for the answer-ended timer). */
  quietMs = 0;
  heardSpeech = false;

  constructor(o: SegmenterOptions = {}) {
    this.pauseMs = o.pauseMs ?? 750;
    this.minSpeechMs = o.minSpeechMs ?? 220;
    this.maxSegmentMs = o.maxSegmentMs ?? 28000;
    this.minThreshold = o.minThreshold ?? 0.012;
  }

  get threshold(): number {
    return Math.max(this.minThreshold, this.noiseFloor * 3);
  }

  /** Feeds one frame's loudness and duration; returns what happened. */
  feed(level: number, frameMs: number): SegmenterEvent {
    const loud = level > this.threshold;
    if (loud) {
      this.voicedMs += frameMs;
      this.silentMs = 0;
      this.quietMs = 0;
    } else {
      this.silentMs += frameMs;
      this.quietMs += frameMs;
      if (!this.inSpeech) {
        this.voicedMs = Math.max(0, this.voicedMs - frameMs);
        // Learn the room's background noise only while nobody speaks.
        this.noiseFloor = this.noiseFloor * 0.95 + Math.min(level, 0.05) * 0.05;
      }
    }
    if (!this.inSpeech) {
      if (this.voicedMs >= this.minSpeechMs) {
        this.inSpeech = true;
        this.heardSpeech = true;
        this.segmentMs = this.voicedMs;
        return { type: 'speech_start' };
      }
      return null;
    }
    this.segmentMs += frameMs;
    if (this.silentMs >= this.pauseMs) {
      this.inSpeech = false;
      this.voicedMs = 0;
      this.segmentMs = 0;
      return { type: 'cut', reason: 'pause' };
    }
    if (this.segmentMs >= this.maxSegmentMs) {
      this.segmentMs = 0;
      return { type: 'cut', reason: 'max' };
    }
    return null;
  }
}

// Audio helpers for the voice recorder. Pure functions (no browser APIs), unit-tested in wav.test.ts.

/** Speech models work best on 16 kHz mono; it also keeps a 30-second segment under 1 MB. */
export const TARGET_RATE = 16000;

/** Averages input samples into the target rate (simple low-pass + decimation, good enough for speech). */
export function downsample(input: Float32Array, inRate: number, outRate = TARGET_RATE): Float32Array {
  if (!input.length || inRate <= 0) return new Float32Array(0);
  if (inRate === outRate) return input.slice();
  if (inRate < outRate) {
    // Upsample by linear interpolation (rare: some devices record at 8 kHz).
    const ratio = inRate / outRate;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const a = Math.floor(pos);
      const b = Math.min(a + 1, input.length - 1);
      out[i] = input[a] + (input[b] - input[a]) * (pos - a);
    }
    return out;
  }
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  let pos = 0;
  for (let i = 0; i < out.length; i++) {
    const next = Math.round((i + 1) * ratio);
    let sum = 0;
    let n = 0;
    for (let j = pos; j < next && j < input.length; j++) { sum += input[j]; n++; }
    out[i] = n ? sum / n : 0;
    pos = next;
  }
  return out;
}

/** Joins recorded frames into one buffer. */
export function concatFrames(frames: readonly Float32Array[]): Float32Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const f of frames) { out.set(f, at); at += f.length; }
  return out;
}

/** Complete 16-bit PCM mono WAV file (44-byte header + samples). */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
    offset += 2;
  }
  return bytes;
}

/** Root-mean-square loudness of one frame (0 = silence, about 0.3 = loud speech). */
export function rms(frame: Float32Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** Loudness as a 0..1 meter value (log scale, so quiet speech still moves the bar). */
export function meterLevel(value: number): number {
  if (value <= 0) return 0;
  const db = 20 * Math.log10(value);
  return Math.max(0, Math.min(1, (db + 60) / 50));
}

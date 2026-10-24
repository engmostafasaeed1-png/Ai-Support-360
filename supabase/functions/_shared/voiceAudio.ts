// Checks an uploaded voice segment before it reaches the speech model. Pure (no Deno or browser APIs).
// Only complete PCM WAV files are accepted: the browser recorder always produces them (16 kHz mono 16-bit), they decode
// on every browser (Safari's compressed recordings often do not), and their length can be read exactly from the header,
// so the per-interview and per-day minute caps cannot be fooled by a wrong duration from the browser.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  seconds: number;
}

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** Reads a RIFF/WAVE PCM header. Returns null for anything else (other formats, broken or truncated files). */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.length) return null;
      fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) return null;
      if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.channels > 2 || fmt.sampleRate < 8000 || fmt.sampleRate > 48000) return null;
      const dataBytes = Math.min(size, bytes.length - body);
      if (dataBytes <= 0) return null;
      const seconds = dataBytes / (fmt.sampleRate * fmt.channels * 2);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16, dataBytes, seconds: Math.round(seconds * 100) / 100 };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

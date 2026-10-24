// How sure are we that a recording was heard right? The transcription endpoint returns no word confidences, so this
// combines (1) agreement between two different speech models, (2) plausibility checks (speaking rate, repeated
// phrases, typical "hallucinated" filler, empty output) and (3) the browser's audio-quality measurement.
// Pure (unit-tested); shared by voice-transcribe, the browser and the benchmark.
import { alignWords, normToken, tokenize, wer } from "./voiceText.ts";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceInput {
  text: string;
  seconds: number;
  /** Second model's text for the same audio, when it was run. */
  secondary?: string | null;
  /** Browser measurements of the recording. */
  snrDb?: number | null;
  clipped?: boolean;
}

export interface ConfidenceResult { score: number; level: ConfidenceLevel; reasons: string[]; agreement: number | null }

const HALLUCINATIONS = [
  /thank(s| you) for watching/i, /subscribe/i, /subtitles? (by|from)/i, /amara\.org/i, /\bmusic\b.*\bplaying\b/i,
  /ترجمة|اشتركوا|شكرا للمشاهدة|المترجم/,
];

export function hasRepeatedPhrase(text: string): boolean {
  const t = tokenize(text);
  if (t.length < 9) return false;
  const counts = new Map<string, number>();
  for (let i = 0; i + 3 <= t.length; i++) {
    const k = t.slice(i, i + 3).join(" ");
    const n = (counts.get(k) ?? 0) + 1;
    if (n >= 3) return true;
    counts.set(k, n);
  }
  return false;
}

export function segmentConfidence(i: ConfidenceInput, lowBelow = 0.45, highFrom = 0.75): ConfidenceResult {
  const reasons: string[] = [];
  const words = tokenize(i.text).length;
  let score = 0.85;
  if (!words) {
    return { score: i.seconds >= 1 ? 0.1 : 0.4, level: "low", reasons: ["empty"], agreement: null };
  }
  const rate = words / Math.max(0.5, i.seconds);
  if (i.seconds >= 2 && rate < 0.35) { score -= 0.35; reasons.push("too_few_words"); }
  if (rate > 6) { score -= 0.35; reasons.push("too_many_words"); }
  if (hasRepeatedPhrase(i.text)) { score -= 0.45; reasons.push("repeated_phrase"); }
  if (HALLUCINATIONS.some((re) => re.test(i.text))) { score -= 0.5; reasons.push("filler_phrase"); }
  if (i.snrDb != null && i.snrDb < 8) { score -= 0.2; reasons.push("noisy"); }
  if (i.clipped) { score -= 0.1; reasons.push("clipped"); }
  let agreement: number | null = null;
  if (i.secondary != null) {
    agreement = Math.max(0, 1 - wer(i.text, i.secondary));
    // Agreement is the strongest signal: two different models hearing the same words.
    score = score * 0.45 + agreement * 0.55;
    if (agreement < 0.5) reasons.push("models_disagree");
  }
  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score, level: score < lowBelow ? "low" : score >= highFrom ? "high" : "medium", reasons, agreement };
}

export interface UncertainWord { word: string; index: number; alternative: string | null }

/** Words of the primary text that the second model heard differently, with the other model's version as a one-tap fix. */
export function uncertainWords(primary: string, secondary: string | null | undefined, max = 12): UncertainWord[] {
  if (!secondary) return [];
  const words = String(primary ?? "").trim().split(/\s+/).filter(Boolean);
  const other = String(secondary).trim().split(/\s+/).filter(Boolean);
  const ops = alignWords(words.map(normToken), other.map(normToken));
  const out: UncertainWord[] = [];
  for (const op of ops) {
    if (op.op === "sub" && op.refIndex != null) {
      const w = words[op.refIndex];
      if (normToken(w).length < 2) continue;
      out.push({ word: w, index: op.refIndex, alternative: op.hypIndex != null ? other[op.hypIndex] : null });
    } else if (op.op === "del" && op.refIndex != null && normToken(words[op.refIndex]).length >= 4) {
      out.push({ word: words[op.refIndex], index: op.refIndex, alternative: null });
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Picks the text to show when both models ran: the hinted primary, unless it fails the checks and the other passes. */
export function chooseText(primary: { text: string }, secondary: { text: string } | null, seconds: number): "primary" | "secondary" {
  if (!secondary) return "primary";
  const p = segmentConfidence({ text: primary.text, seconds });
  const s = segmentConfidence({ text: secondary.text, seconds });
  return p.level === "low" && s.level !== "low" ? "secondary" : "primary";
}

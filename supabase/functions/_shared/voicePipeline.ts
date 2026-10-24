// The complete server path from one recorded piece to text, shared by voice-transcribe and the offline benchmark so
// the benchmark measures exactly what consultants get:
//   1. primary model with SAP hints (+ second model in parallel when cross-check is "always", or afterwards when the
//      primary looks unreliable and cross-check is "low_confidence");
//   2. pick the base text, clean Arabic (digits 0-9, no vowel marks), rule-based SAP spelling fixes;
//   3. constrained correction pass (text model may only swap sound-alike glossary terms; diff kept);
//   4. confidence from model agreement + plausibility + audio quality, uncertain words with one-tap alternatives,
//      language of this piece.
import { transcribeAudio, VOICE_MODELS, type TranscribeHints, type TranscribeOutcome } from "./voiceProviders.ts";
import { correctTranscript, detectLanguage } from "./voiceGlossary.ts";
import { correctWithModel, type Change } from "./voiceCorrection.ts";
import { chooseText, segmentConfidence, uncertainWords, type ConfidenceResult, type UncertainWord } from "./voiceConfidence.ts";
import { normalizeArabic } from "./voiceText.ts";

export type CrossCheck = "always" | "low_confidence" | "off";

export interface PipelineArgs {
  apiKey: string;
  wav: Uint8Array;
  seconds: number;
  primaryModel: string;
  secondaryModel: string | null;
  crossCheck: CrossCheck;
  correction: boolean;
  hints: TranscribeHints;
  /** Hint keywords + module terms + admin vocabulary (correctionGlossary). */
  glossary: readonly string[];
  question?: string | null;
  snrDb?: number | null;
  clipped?: boolean;
  lowBelow?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export interface PipelineResult {
  ok: boolean;
  status: number;
  error?: string;
  text: string;
  raw: string;
  rawSecondary: string | null;
  modelUsed: string;
  secondaryUsed: string | null;
  changes: Change[];
  ruleChanges: Change[];
  uncertain: UncertainWord[];
  confidence: ConfidenceResult;
  language: string | null;
  latencyMs: number;
  billedSeconds: number | null;
  usage: Array<{ model: string; usage: Record<string, unknown> | null; seconds: number | null; ok: boolean; latencyMs: number }>;
  gatewayHeaders: Record<string, string>;
  correctionCalled: boolean;
}

export async function runVoicePipeline(a: PipelineArgs): Promise<PipelineResult> {
  const started = Date.now();
  const second = a.secondaryModel && a.secondaryModel !== a.primaryModel && VOICE_MODELS[a.secondaryModel] ? a.secondaryModel : null;
  const call = (model: string, onDelta?: (t: string) => void) =>
    transcribeAudio({ apiKey: a.apiKey, model, wav: a.wav, hints: a.hints, signal: a.signal, onDelta });
  type Run = { model: string; out: TranscribeOutcome };
  const runs: Run[] = [];

  const parallel = !!second && a.crossCheck === "always";
  const [pOut, sOut] = await Promise.all([call(a.primaryModel, a.onDelta), parallel ? call(second!) : Promise.resolve(null)]);
  let primaryRun: Run = { model: a.primaryModel, out: pOut };
  runs.push(primaryRun);
  let secondaryRun: Run | null = sOut ? { model: second!, out: sOut } : null;
  if (secondaryRun) runs.push(secondaryRun);
  // Primary failed: the second model answers alone, so the consultant is not dropped to browser recognition.
  if (!pOut.ok && second) {
    if (!secondaryRun) { secondaryRun = { model: second, out: await call(second, a.onDelta) }; runs.push(secondaryRun); }
    if (secondaryRun.out.ok) { primaryRun = secondaryRun; secondaryRun = null; }
  }
  const usage = () => runs.map((r) => ({ model: r.model, usage: r.out.usage, seconds: r.out.seconds, ok: r.out.ok, latencyMs: r.out.latencyMs }));
  if (!primaryRun.out.ok) {
    return {
      ok: false, status: primaryRun.out.status, error: primaryRun.out.error, text: "", raw: "", rawSecondary: null, modelUsed: a.primaryModel, secondaryUsed: null,
      changes: [], ruleChanges: [], uncertain: [], confidence: { score: 0, level: "low", reasons: ["failed"], agreement: null }, language: null,
      latencyMs: Date.now() - started, billedSeconds: null, usage: usage(), gatewayHeaders: primaryRun.out.gatewayHeaders, correctionCalled: false,
    };
  }
  if (!parallel && second && a.crossCheck === "low_confidence" && !secondaryRun && primaryRun.model === a.primaryModel) {
    const first = segmentConfidence({ text: primaryRun.out.text, seconds: a.seconds, snrDb: a.snrDb, clipped: a.clipped }, a.lowBelow ?? 0.45);
    if (first.level !== "high") { secondaryRun = { model: second, out: await call(second) }; runs.push(secondaryRun); }
  }
  const secondOk = secondaryRun?.out.ok ? secondaryRun : null;
  const pick = secondOk ? chooseText(primaryRun.out, secondOk.out, a.seconds) : "primary";
  const baseRun = pick === "primary" ? primaryRun : secondOk!;
  const otherRun = pick === "primary" ? secondOk : primaryRun;

  const raw = normalizeArabic(baseRun.out.text);
  const otherText = otherRun ? normalizeArabic(otherRun.out.text) : null;
  const rule = correctTranscript(raw, a.glossary);
  let text = rule.text;
  let changes: Change[] = [];
  let modelUncertain: string[] = [];
  let correctionCalled = false;
  if (a.correction && raw.trim()) {
    const c = await correctWithModel({ apiKey: a.apiKey, raw: text, alternative: otherText, question: a.question, glossary: a.glossary, signal: a.signal });
    correctionCalled = c.called;
    text = c.text;
    changes = c.applied;
    modelUncertain = c.uncertain;
  }
  const confidence = segmentConfidence({ text: raw, seconds: a.seconds, secondary: otherText, snrDb: a.snrDb, clipped: a.clipped }, a.lowBelow ?? 0.45);
  const fromModels = uncertainWords(text, otherText);
  const words = text.split(/\s+/);
  const extra: UncertainWord[] = modelUncertain
    .map((w) => ({ word: w, index: words.findIndex((x) => x.replace(/[.,،;:!?؟]+$/u, "") === w), alternative: null }))
    .filter((u) => u.index >= 0 && !fromModels.some((f) => f.index === u.index));
  const uncertain = [...fromModels, ...extra].sort((x, y) => x.index - y.index).slice(0, 15);
  return {
    ok: true, status: 200, text, raw, rawSecondary: otherText, modelUsed: baseRun.model, secondaryUsed: otherRun?.model ?? null,
    changes, ruleChanges: rule.changes, uncertain, confidence, language: detectLanguage(text, (baseRun.out.languages ?? []).map((code) => ({ code }))),
    latencyMs: Date.now() - started, billedSeconds: baseRun.out.seconds, usage: usage(), gatewayHeaders: primaryRun.out.gatewayHeaders, correctionCalled,
  };
}

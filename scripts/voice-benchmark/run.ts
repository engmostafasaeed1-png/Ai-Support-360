// Offline accuracy benchmark for interview speech-to-text (no real user audio).
//
//   bun scripts/voice-benchmark/run.ts --audio <dir> [--out <dir>] [--models a,b] [--correct] [--concurrency 3]
//   bun scripts/voice-benchmark/run.ts --tts /tmp/voice-tts --out /tmp/voice-report     (synthetic smoke run)
//
// <dir> holds the owner's recordings named after the sentence ids in sentences.json (01.wav, 02.m4a, ...). Any format
// ffmpeg reads is converted to 24 kHz mono 16-bit WAV, the format the app sends. --tts generates missing recordings with
// the gateway's speech model instead (clean studio voices: useful to compare models, NOT a measure of real accuracy).
// Needs LOVABLE_API_KEY in the environment and ffmpeg on the path. Writes report.md and results.csv to --out.
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { buildVoiceGlossary } from "../../supabase/functions/_shared/voiceGlossary.ts";
import { languageHints } from "../../supabase/functions/_shared/voiceSettings.ts";
import { transcribeAudio, VOICE_MODELS } from "../../supabase/functions/_shared/voiceProviders.ts";
import { normalizeArabic, wer } from "../../supabase/functions/_shared/voiceText.ts";
import { correctTranscript } from "../../supabase/functions/_shared/voiceGlossary.ts";
import { correctWithModel } from "../../supabase/functions/_shared/voiceCorrection.ts";
import { segmentConfidence } from "../../supabase/functions/_shared/voiceConfidence.ts";

type Sentence = { id: string; category: string; lang: string; dialect?: string; modules: string[]; text: string };
const here = dirname(new URL(import.meta.url).pathname);
const sentences: Sentence[] = JSON.parse(readFileSync(join(here, "sentences.json"), "utf8")).sentences;

const arg = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const apiKey = process.env.LOVABLE_API_KEY;
if (!apiKey) { console.error("LOVABLE_API_KEY is not set"); process.exit(1); }
const ttsDir = arg("tts");
const audioDir = arg("audio") ?? ttsDir;
if (!audioDir) { console.error("Pass --audio <dir> (owner recordings) or --tts <dir> (synthetic)"); process.exit(1); }
const outDir = arg("out", "/tmp/voice-benchmark-report")!;
const models = (arg("models") ?? Object.keys(VOICE_MODELS).join(",")).split(",").filter(Boolean);
const concurrency = Number(arg("concurrency", "3"));
const runCorrection = flag("correct");
const only = arg("only")?.split(",");
mkdirSync(outDir, { recursive: true });
mkdirSync(audioDir, { recursive: true });

async function synthesize(s: Sentence, file: string) {
  const style = s.lang === "en" ? "Say naturally, like an SAP consultant answering an interview question:" :
    `Say in natural spoken ${s.dialect ?? "Egyptian"} Arabic, like an SAP consultant in an interview; keep English words and SAP terms in English:`;
  const body = {
    model: "google/gemini-3.1-flash-tts-preview",
    contents: [{ role: "user", parts: [{ text: `${style} ${s.text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: Number(s.id) % 2 ? "Kore" : "Puck" } } } },
    stream_format: "audio",
  };
  const r = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`tts ${s.id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  writeFileSync(file, new Uint8Array(await r.arrayBuffer()));
}

function findRecording(id: string): string | null {
  const f = readdirSync(audioDir!).find((n) => n.startsWith(`${id}.`) && !n.endsWith(".24k.wav"));
  return f ? join(audioDir!, f) : null;
}

function toWav24k(src: string): Uint8Array {
  const dst = src.replace(/\.[^.]+$/, ".24k.wav");
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", "24000", "-sample_fmt", "s16", dst]);
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${src}: ${r.stderr}`);
  return new Uint8Array(readFileSync(dst));
}

type Row = {
  id: string; category: string; lang: string; model: string; variant: string; ok: boolean; seconds: number; latency_ms: number;
  credits: number; wer_raw: number; wer_corrected: number; confidence: string; reference: string; raw: string; corrected: string; error?: string;
};

function credits(model: string, seconds: number, usage: Record<string, unknown> | null): number {
  if (model === "openai/gpt-transcribe") return seconds * 0.0003;
  const inTok = Number((usage as any)?.input_tokens ?? (usage as any)?.prompt_tokens ?? 0);
  const outTok = Number((usage as any)?.output_tokens ?? (usage as any)?.completion_tokens ?? 0);
  return inTok ? inTok * 0.000008 + outTok * 0.000048 : seconds * (VOICE_MODELS[model]?.creditsPerMinute ?? 0) / 60;
}

async function runOne(s: Sentence, wav: Uint8Array, model: string, variant: "hints" | "no_hints"): Promise<Row> {
  const info = VOICE_MODELS[model];
  const g = buildVoiceGlossary({ modules: s.modules, lang: s.lang === "en" ? "en" : "ar" });
  const hints = variant === "hints" ? { prompt: g.prompt, keywords: g.keywords, languages: languageHints(s.lang === "en" ? "en" : "ar") } : {};
  const out = await transcribeAudio({ apiKey: apiKey!, model, wav, hints, fileName: `${s.id}.wav` });
  const seconds = out.seconds ?? (wav.length - 44) / 48000;
  const raw = normalizeArabic(out.text);
  let corrected = correctTranscript(raw, g.keywords).text;
  if (runCorrection && out.ok) corrected = (await correctWithModel({ apiKey: apiKey!, raw: corrected, glossary: g.keywords })).text;
  const conf = segmentConfidence({ text: raw, seconds });
  return {
    id: s.id, category: s.category, lang: s.lang, model: info?.label ?? model, variant: info?.hints ? variant : "auto", ok: out.ok, seconds,
    latency_ms: out.latencyMs, credits: credits(model, seconds, out.usage), wer_raw: out.ok ? wer(s.text, raw) : 1, wer_corrected: out.ok ? wer(s.text, corrected) : 1,
    confidence: conf.level, reference: s.text, raw, corrected, error: out.error,
  };
}

async function pool<T>(items: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await items[k](); } }));
  return out;
}

const chosen = sentences.filter((s) => !only || only.includes(s.id));
const jobs: (() => Promise<Row>)[] = [];
for (const s of chosen) {
  let file = findRecording(s.id);
  if (!file && ttsDir) { file = join(ttsDir, `${s.id}.wav`); await synthesize(s, file); }
  if (!file) { console.warn(`missing recording for ${s.id}, skipped`); continue; }
  const wav = toWav24k(file);
  for (const m of models) {
    const variants: Array<"hints" | "no_hints"> = VOICE_MODELS[m]?.hints ? ["hints", "no_hints"] : ["no_hints"];
    for (const v of variants) jobs.push(() => runOne(s, wav, m, v));
  }
}
console.log(`running ${jobs.length} transcriptions (${models.join(", ")})…`);
const rows = await pool(jobs, concurrency);

// ----- report -----
const groups = new Map<string, Row[]>();
for (const r of rows) { const k = `${r.model} | ${r.variant}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const categories = [...new Set(rows.map((r) => r.category))];
let md = `# Speech-to-text benchmark\n\nSource: ${ttsDir ? "synthetic voices (gateway text-to-speech) — compares models, does not measure real accents" : `recordings in ${audioDir}`}\n`;
md += `Sentences: ${chosen.length} · Correction pass: ${runCorrection ? "on" : "rule-based only"} · Date: ${new Date().toISOString()}\n\n`;
md += `| Model | Hints | WER raw | WER corrected | ${categories.map((c) => `WER ${c}`).join(" | ")} | Avg wait | Credits/min | Failed |\n|---|---|---|---|${categories.map(() => "---|").join("")}---|---|---|\n`;
for (const [k, rs] of groups) {
  const [model, variant] = k.split(" | ");
  const secs = rs.reduce((a, r) => a + r.seconds, 0);
  md += `| ${model} | ${variant} | ${pct(mean(rs.map((r) => r.wer_raw)))} | ${pct(mean(rs.map((r) => r.wer_corrected)))} | ${categories.map((c) => pct(mean(rs.filter((r) => r.category === c).map((r) => r.wer_corrected)))).join(" | ")} | ${Math.round(mean(rs.map((r) => r.latency_ms)))} ms | ${(rs.reduce((a, r) => a + r.credits, 0) / Math.max(1, secs / 60)).toFixed(4)} | ${rs.filter((r) => !r.ok).length} |\n`;
}
md += `\nWER = word error rate against the reference (0 % = perfect). "corrected" = after the SAP spelling fixes.\n\n## Worst sentences per model\n`;
for (const [k, rs] of groups) {
  md += `\n### ${k}\n`;
  for (const r of [...rs].sort((a, b) => b.wer_corrected - a.wer_corrected).slice(0, 5)) md += `- ${r.id} (${pct(r.wer_corrected)}): ${r.corrected || r.error}\n  - expected: ${r.reference}\n`;
}
writeFileSync(join(outDir, "report.md"), md);
const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const cols: (keyof Row)[] = ["id", "category", "lang", "model", "variant", "ok", "seconds", "latency_ms", "credits", "wer_raw", "wer_corrected", "confidence", "reference", "raw", "corrected", "error"];
writeFileSync(join(outDir, "results.csv"), [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n"));
console.log(md);
if (!existsSync(join(outDir, "report.md"))) process.exit(1);

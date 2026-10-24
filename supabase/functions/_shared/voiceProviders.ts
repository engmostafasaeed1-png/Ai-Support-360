// Speech-to-text models behind one interface, so the admin setting can switch model without code changes.
// Uses only fetch/FormData (works in Deno, Bun and the benchmark script). Request shapes follow the gateway's
// /v1/audio/transcriptions contract: GPT Transcribe takes prompt, keywords[] and languages[] hints; Gemini Transcribe
// takes no hints (it auto-detects the language of every recording). Neither returns word timings or confidences on
// this endpoint, so confidence is derived from model agreement (see voiceConfidence.ts).

export const TRANSCRIBE_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";

export interface VoiceModelInfo {
  id: string;
  label: string;
  /** Accepts prompt + keyword hints (SAP vocabulary). */
  hints: boolean;
  /** Accepts several language hints. */
  languageHints: boolean;
  /** Credits per audio minute: exact for duration-priced models, measured estimate for token-priced ones. */
  creditsPerMinute: number;
  priceBasis: "duration" | "tokens (estimate)";
}

/** Current, non-deprecated transcription models in the workspace catalogue (2026-10-24). */
export const VOICE_MODELS: Readonly<Record<string, VoiceModelInfo>> = {
  "openai/gpt-transcribe": { id: "openai/gpt-transcribe", label: "GPT Transcribe", hints: true, languageHints: true, creditsPerMinute: 0.018, priceBasis: "duration" },
  "google/gemini-3.5-transcribe": { id: "google/gemini-3.5-transcribe", label: "Gemini 3.5 Transcribe", hints: false, languageHints: false, creditsPerMinute: 0.026, priceBasis: "tokens (estimate)" },
};

export const DEFAULT_PRIMARY_MODEL = "openai/gpt-transcribe";
export const DEFAULT_SECONDARY_MODEL = "google/gemini-3.5-transcribe";

export function isVoiceModel(id: unknown): id is string {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(VOICE_MODELS, id);
}

export interface TranscribeHints { prompt?: string; keywords?: readonly string[]; languages?: readonly string[] }

export function buildTranscriptionForm(model: string, wav: Uint8Array, hints: TranscribeHints = {}, fileName = "segment.wav"): FormData {
  const info = VOICE_MODELS[model];
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), fileName);
  form.append("response_format", "json");
  form.append("stream", "true");
  if (info?.hints) {
    if (hints.prompt) form.append("prompt", hints.prompt);
    for (const k of hints.keywords ?? []) form.append("keywords[]", k);
  }
  if (info?.languageHints) for (const l of hints.languages ?? []) form.append("languages[]", l);
  return form;
}

export interface TranscribeOutcome {
  ok: boolean;
  status: number;
  text: string;
  languages: string[];
  seconds: number | null;
  usage: Record<string, unknown> | null;
  latencyMs: number;
  /** Gateway response headers to forward (X-Lovable-AIG-*). */
  gatewayHeaders: Record<string, string>;
  error?: string;
  retryAfter?: string | null;
}

/** Sends one recording and reads the SSE stream to the end. `onDelta` receives text as it arrives. */
export async function transcribeAudio(args: {
  apiKey: string; model: string; wav: Uint8Array; hints?: TranscribeHints; signal?: AbortSignal; onDelta?: (text: string) => void; fileName?: string;
}): Promise<TranscribeOutcome> {
  const started = Date.now();
  const gatewayHeaders: Record<string, string> = {};
  let resp: Response;
  try {
    resp = await fetch(TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
      body: buildTranscriptionForm(args.model, args.wav, args.hints, args.fileName),
      signal: args.signal,
    });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return { ok: false, status: aborted ? 499 : 0, text: "", languages: [], seconds: null, usage: null, latencyMs: Date.now() - started, gatewayHeaders, error: aborted ? "aborted" : "network" };
  }
  resp.headers.forEach((v, k) => { if (k.toLowerCase().startsWith("x-lovable-aig-")) gatewayHeaders[k] = v; });
  if (!resp.ok || !resp.body) {
    await resp.body?.cancel().catch(() => undefined);
    return { ok: false, status: resp.status, text: "", languages: [], seconds: null, usage: null, latencyMs: Date.now() - started, gatewayHeaders, error: `http_${resp.status}`, retryAfter: resp.headers.get("Retry-After") };
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "";
  let done: { text?: string; languages?: Array<{ code?: string } | string>; usage?: Record<string, unknown> } | null = null;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(payload); } catch { continue; }
        if (ev.type === "transcript.text.delta" && typeof ev.delta === "string") { text += ev.delta; args.onDelta?.(text); }
        else if (ev.type === "transcript.text.done") done = ev as typeof done;
        else if (ev.type === "error" || ev.error) throw new Error("stream_error");
      }
    }
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return { ok: false, status: aborted ? 499 : 502, text, languages: [], seconds: null, usage: null, latencyMs: Date.now() - started, gatewayHeaders, error: aborted ? "aborted" : "stream_error" };
  }
  if (!done) return { ok: false, status: 502, text, languages: [], seconds: null, usage: null, latencyMs: Date.now() - started, gatewayHeaders, error: "stream_incomplete" };
  const usage = (done.usage ?? null) as Record<string, unknown> | null;
  const langs = (Array.isArray(done.languages) ? done.languages : [])
    .map((l) => (typeof l === "string" ? l : l?.code || "")).map((c) => c.toLowerCase().split(/[-_]/)[0]).filter((c) => /^[a-z]{2}$/.test(c));
  return {
    ok: true, status: 200, text: typeof done.text === "string" ? done.text : text, languages: [...new Set(langs)],
    seconds: typeof usage?.seconds === "number" ? (usage.seconds as number) : null, usage, latencyMs: Date.now() - started, gatewayHeaders,
  };
}

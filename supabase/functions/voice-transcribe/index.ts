// Server speech-to-text for the AI interview and every voice-input field (docs/interview-voice.md).
//
// POST multipart/form-data: file (complete 16 kHz mono 16-bit WAV from the browser recorder), context ("interview" or
// "dictation"), interview_id (interview only), segment (number), lang (interview language or "auto").
// GET ?probe=1: { ready } so the browser can choose the recogniser before the first answer.
//
// Safety: signed-in callers only; the interview must belong to the caller and still be open; size, length, format,
// per-minute rate and per-interview / per-day audio minutes are checked (minutes atomically in the database through
// the service-only voice_claim_segment, docs/sql/interview-voice.sql). Until that SQL is applied the function answers
// "not_ready" and browsers keep using their built-in recogniser. Audio is processed in memory and sent only to the
// AI gateway's speech model; it is stored only when the admin setting "store interview audio" is on (default off).
// Logs carry status codes only, never text, audio or e-mail addresses.
import { z } from "https://esm.sh/zod@3.23.8";
import { adminClient, authenticateUser, corsHeaders, jsonResponse, preflight, withinRateLimit } from "../_shared/security.ts";
import { languageHints, normalizeVoiceSettings, VOICE_MAX_UPLOAD_BYTES, VOICE_MIN_SECONDS, VOICE_MODEL, VOICE_SETTINGS_KEY } from "../_shared/voiceSettings.ts";
import { parseWav } from "../_shared/voiceAudio.ts";
import { buildVoiceGlossary, correctTranscript, detectLanguage, SAP_CORE_TERMS } from "../_shared/voiceGlossary.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const AUDIO_BUCKET = "interview-audio";

const Fields = z.object({
  context: z.enum(["interview", "dictation"]),
  interview_id: z.string().uuid().optional(),
  segment: z.coerce.number().int().min(0).max(5000).default(0),
  lang: z.string().max(10).regex(/^[a-zA-Z-]*$/).optional(),
});

// deno-lint-ignore no-explicit-any
type Db = any;

async function loadSettings(db: Db) {
  const { data } = await db.from("platform_settings").select("value").eq("key", VOICE_SETTINGS_KEY).maybeSingle();
  return normalizeVoiceSettings(data?.value);
}

/** True once docs/sql/interview-voice.sql is applied (the claim function and metrics table exist). */
async function voiceTablesReady(db: Db): Promise<boolean> {
  const { error, status } = await db.from("voice_transcription_segments").select("id").limit(1);
  return !error && status !== 404;
}

function lastQuestion(skillResults: unknown): string {
  if (!Array.isArray(skillResults)) return "";
  for (let i = skillResults.length - 1; i >= 0; i--) {
    const m = skillResults[i] as { role?: string; content?: unknown };
    if (m?.role === "assistant" && typeof m.content === "string") return m.content.slice(-600);
  }
  return "";
}

async function interviewGlossaryInput(db: Db, consultantId: string, interviewId: string, skillResults: unknown, lang?: string) {
  let skills: Array<{ sap_module?: string; sap_version?: string }> = [];
  const withVersion = await db.from("consultant_skills").select("sap_module, sap_version").eq("consultant_id", consultantId).limit(30);
  if (!withVersion.error) skills = withVersion.data ?? [];
  else skills = (await db.from("consultant_skills").select("sap_module").eq("consultant_id", consultantId).limit(30)).data ?? [];
  // Interview plan from the knowledge base (docs/sql/interview-knowledge.sql); missing table or plan: just skipped.
  let planText = "";
  try {
    const { data: plan, error } = await db.from("interview_plans").select("questions").eq("interview_id", interviewId).maybeSingle();
    if (!error && Array.isArray(plan?.questions)) {
      planText = plan.questions.map((q: { question?: unknown; key_points?: unknown }) => `${typeof q?.question === "string" ? q.question : ""} ${Array.isArray(q?.key_points) ? q.key_points.join(" ") : typeof q?.key_points === "string" ? q.key_points : ""}`).join("\n").slice(0, 12000);
    }
  } catch { /* optional */ }
  return {
    modules: skills.map((s) => s.sap_module ?? ""),
    versions: skills.map((s) => (typeof s.sap_version === "string" ? s.sap_version : "")).filter(Boolean),
    question: lastQuestion(skillResults),
    planText,
    lang,
  };
}

/** Reads the gateway's SSE transcript stream to the end: deltas append, the done event carries the final text. */
async function readTranscript(resp: Response): Promise<{ text: string; languages: unknown[]; seconds: number | null }> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let done: { text?: string; languages?: unknown[]; usage?: { seconds?: number } } | null = null;
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
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "transcript.text.delta" && typeof ev.delta === "string") text += ev.delta;
        else if (ev.type === "transcript.text.done") done = ev;
        else if (ev.type === "error" || ev.error) throw new Error("stream_error");
      } catch (e) {
        if ((e as Error).message === "stream_error") throw e;
      }
    }
  }
  if (!done) throw new Error("stream_incomplete");
  return { text: typeof done.text === "string" ? done.text : text, languages: Array.isArray(done.languages) ? done.languages : [], seconds: typeof done.usage?.seconds === "number" ? done.usage.seconds : null };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const fail = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    jsonResponse(req, { error: code, code, ...extra }, status, headers);

  const user = await authenticateUser(req);
  if (!user) return fail(401, "unauthorized");
  const db = adminClient();

  if (req.method === "GET") {
    const settings = await loadSettings(db);
    const ready = settings.server_stt && (await voiceTablesReady(db));
    return jsonResponse(req, { ready, reason: !settings.server_stt ? "disabled" : ready ? null : "not_ready", model: VOICE_MODEL, max_segment_seconds: settings.max_segment_seconds });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...corsHeaders(req), Allow: "GET, POST, OPTIONS" } });

  const declared = Number(req.headers.get("content-length") ?? "");
  if (!Number.isFinite(declared) || declared <= 0) return fail(411, "length_required");
  if (declared > VOICE_MAX_UPLOAD_BYTES + 4096) return fail(413, "too_large");
  if (!(await withinRateLimit(db, `voice-transcribe:${user.id}`, 40, 60))) return fail(429, "rate_limited", {}, { "Retry-After": "30" });

  const settings = await loadSettings(db);
  if (!settings.server_stt) return fail(503, "disabled");

  let form: FormData;
  try { form = await req.formData(); } catch { return fail(400, "bad_form"); }
  const parsed = Fields.safeParse({
    context: form.get("context") ?? undefined,
    interview_id: (form.get("interview_id") as string | null) || undefined,
    segment: form.get("segment") ?? 0,
    lang: (form.get("lang") as string | null) || undefined,
  });
  if (!parsed.success) return fail(400, "bad_fields");
  const { context, interview_id, segment, lang } = parsed.data;
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > VOICE_MAX_UPLOAD_BYTES) return fail(413, "too_large");
  if (!/^audio\/(wav|x-wav|wave)$/i.test(file.type)) return fail(415, "not_audio");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const wav = parseWav(bytes);
  if (!wav) return fail(415, "not_audio");
  if (wav.seconds < VOICE_MIN_SECONDS) return fail(422, "too_short");
  if (wav.seconds > settings.max_segment_seconds + 1) return fail(413, "too_long");

  // Interview: the caller must be the consultant of an open AI interview.
  let glossaryInput: Parameters<typeof buildVoiceGlossary>[0] = { modules: [], versions: [], lang };
  if (context === "interview") {
    if (!interview_id) return fail(400, "bad_fields");
    const { data: s } = await db.from("interview_sessions").select("consultant_id, status, interview_type, skill_results").eq("id", interview_id).maybeSingle();
    if (!s) return fail(404, "not_found");
    const { data: c } = await db.from("consultants").select("user_id").eq("id", s.consultant_id).maybeSingle();
    if (c?.user_id !== user.id) return fail(403, "forbidden");
    if (s.interview_type !== "ai" || !["pending", "in_progress"].includes(s.status)) return fail(409, "closed");
    glossaryInput = await interviewGlossaryInput(db, s.consultant_id, interview_id, s.skill_results, lang);
  } else {
    // Dictation (ticket text, chat, proposals): the caller's own profile modules when they are a consultant.
    const { data: c } = await db.from("consultants").select("id").eq("user_id", user.id).maybeSingle();
    if (c?.id) {
      const { data: sk } = await db.from("consultant_skills").select("sap_module").eq("consultant_id", c.id).limit(20);
      glossaryInput = { modules: (sk ?? []).map((r: { sap_module?: string }) => r.sap_module ?? ""), versions: [], lang };
    }
  }

  // Minutes per interview / per day, decided atomically in the database.
  const claim = await db.rpc("voice_claim_segment", { _user_id: user.id, _interview_id: interview_id ?? null, _context: context, _seconds: wav.seconds, _bytes: bytes.length, _segment: segment, _model: VOICE_MODEL });
  if (claim.error) {
    console.warn("voice claim unavailable:", claim.error.code ?? "error");
    return fail(503, "not_ready");
  }
  const granted = claim.data as { ok?: boolean; reason?: string; id?: string } | null;
  if (!granted?.ok || !granted.id) return fail(429, granted?.reason || "quota");
  const segmentId = granted.id;

  const finish = (patch: Record<string, unknown>) =>
    db.rpc("voice_finish_segment", { _id: segmentId, _status: "failed", _latency_ms: null, _language: null, _corrected: false, _seconds: null, _error: null, _audio_path: null, _raw_text: null, _corrections: null, ...patch })
      .then(({ error }: { error?: { code?: string } }) => { if (error) console.warn("voice finish failed:", error.code ?? "error"); });

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) { await finish({ _error: "config" }); return fail(500, "config"); }

  const glossary = buildVoiceGlossary(glossaryInput);
  const upstream = new FormData();
  upstream.append("model", VOICE_MODEL);
  upstream.append("file", new Blob([bytes], { type: "audio/wav" }), `segment-${segment}.wav`);
  upstream.append("response_format", "json");
  upstream.append("stream", "true");
  upstream.append("prompt", glossary.prompt);
  for (const k of glossary.keywords.length ? glossary.keywords : SAP_CORE_TERMS) upstream.append("keywords[]", k);
  for (const l of languageHints(lang)) upstream.append("languages[]", l);

  const started = Date.now();
  let resp: Response;
  try {
    resp = await fetch(GATEWAY, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" }, body: upstream, signal: req.signal });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    await finish({ _error: aborted ? "aborted" : "network" });
    return fail(aborted ? 499 : 502, aborted ? "aborted" : "provider_unreachable");
  }
  const gatewayHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => { if (k.toLowerCase().startsWith("x-lovable-aig-")) gatewayHeaders[k] = v; });
  if (!resp.ok || !resp.body) {
    const status = resp.status;
    await resp.body?.cancel().catch(() => undefined);
    console.warn("voice provider status:", status);
    await finish({ _error: `http_${status}` });
    const code = status === 429 ? "rate_limited" : status === 402 ? "credits" : status === 403 ? "provider_denied" : status === 400 ? "bad_audio" : "provider_error";
    return fail(status === 429 || status === 402 || status === 403 || status === 400 ? status : 502, code, {}, { ...gatewayHeaders, ...(status === 429 ? { "Retry-After": resp.headers.get("Retry-After") ?? "20" } : {}) });
  }

  let result: Awaited<ReturnType<typeof readTranscript>>;
  try {
    result = await readTranscript(resp);
  } catch (e) {
    const code = (e as Error)?.name === "AbortError" ? "aborted" : "stream_incomplete";
    await finish({ _error: code });
    return fail(code === "aborted" ? 499 : 502, code, {}, gatewayHeaders);
  }
  const latency = Date.now() - started;
  const raw = result.text.trim();
  const corrected = settings.post_correct ? correctTranscript(raw, glossary.keywords) : { text: raw, changes: [] };
  const language = detectLanguage(corrected.text, result.languages as Array<{ code?: string }>);

  // Optional audio copy for admin review (setting off by default). A failed copy never fails the answer.
  let audioPath: string | null = null;
  if (settings.store_audio && context === "interview" && interview_id) {
    const path = `${interview_id}/${segmentId}.wav`;
    const { error } = await db.storage.from(AUDIO_BUCKET).upload(path, bytes, { contentType: "audio/wav", upsert: false });
    if (!error) audioPath = path; else console.warn("voice audio copy skipped");
  }

  await finish({
    _status: "ok", _latency_ms: latency, _language: language, _corrected: corrected.changes.length > 0, _seconds: result.seconds ?? wav.seconds, _audio_path: audioPath,
    // raw text kept for the admin audit of interview answers only (dictation text is not kept)
    _raw_text: context === "interview" ? raw.slice(0, 4000) : null,
    _corrections: corrected.changes.length ? corrected.changes.slice(0, 40) : null,
  });

  return jsonResponse(req, {
    text: corrected.text,
    raw_text: raw,
    language,
    confidence: null,
    seconds: result.seconds ?? wav.seconds,
    corrected: corrected.changes.length > 0,
    corrections: corrected.changes.length,
    latency_ms: latency,
    model: VOICE_MODEL,
  }, 200, gatewayHeaders);
});

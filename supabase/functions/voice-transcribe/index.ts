// Server speech-to-text for the AI interview and every voice-input field (docs/interview-voice.md).
//
// POST multipart/form-data: file (complete 16 kHz mono 16-bit WAV from the browser recorder), context ("interview" or
// "dictation"), interview_id (interview only), segment (number), lang (interview language or "auto"), device (coarse
// class such as "desktop-chrome", optional).
// GET ?probe=1: { ready } so the browser can choose the recogniser before the first answer.
//
// Safety: signed-in callers only; the interview must belong to the caller and still be open; size, length, format,
// per-minute rate and per-interview / per-day audio minutes are checked (minutes atomically in the database through
// the service-only voice_claim_segment, docs/sql/interview-voice.sql). Until that SQL is applied the function answers
// "not_ready" and browsers keep using their built-in recogniser. Audio is processed in memory and sent only to the
// AI gateway's speech model; it is stored only when the admin setting "store interview audio" is on (default off) or,
// for the opt-in training set, when the consultant consented (docs/sql/interview-voice-learning.sql, default off).
//
// Learning (docs/sql/interview-voice-learning.sql, optional until applied): the active learned vocabulary and the
// consultant's own learned words are added to the hints and spelling fixes; the model can be routed per language /
// device / accent group (admin switch, default off); on a small share of interview pieces the other model also listens
// so the nightly job can compare models on the same audio. Our own automatic fixes are recorded as correction pairs.
// Logs carry status codes only, never text, audio or e-mail addresses.
import { z } from "https://esm.sh/zod@3.23.8";
import { adminClient, authenticateUser, corsHeaders, jsonResponse, preflight, withinRateLimit } from "../_shared/security.ts";
import { languageHints, normalizeVoiceSettings, VOICE_MAX_UPLOAD_BYTES, VOICE_MIN_SECONDS, VOICE_MODEL, VOICE_SETTINGS_KEY } from "../_shared/voiceSettings.ts";
import { parseWav } from "../_shared/voiceAudio.ts";
import { buildVoiceGlossary, correctTranscript, detectLanguage, MAX_KEYWORDS, SAP_CORE_TERMS } from "../_shared/voiceGlossary.ts";
import { isVoiceModel, transcribeAudio, VOICE_MODELS } from "../_shared/voiceProviders.ts";
import { normalizeArabic } from "../_shared/voiceText.ts";
import { applyLearnedReplacements, learnedKeywords, normalizeLearningSettings, type LearnedTerm } from "../_shared/voiceLearning.ts";
import { resolveRoute, type RouteRow } from "../_shared/voiceRouting.ts";

const AUDIO_BUCKET = "interview-audio";
const TRAINING_BUCKET = "voice-training";
/** Share of interview pieces on which the other model also listens, so models can be compared on the same audio. */
const MEASURE_SHARE = 0.15;

const Fields = z.object({
  context: z.enum(["interview", "dictation"]),
  interview_id: z.string().uuid().optional(),
  segment: z.coerce.number().int().min(0).max(5000).default(0),
  lang: z.string().max(10).regex(/^[a-zA-Z-]*$/).optional(),
  device: z.string().max(40).regex(/^[a-z]+-[a-z]+$/).optional(),
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

interface LearningContext {
  settings: ReturnType<typeof normalizeLearningSettings>;
  defaultModel: string;
  version: number | null;
  terms: LearnedTerm[];
  personal: LearnedTerm[];
  accent: string | null;
  audioConsent: string | null;
  routes: RouteRow[];
}

/** Everything learned for this person (null until docs/sql/interview-voice-learning.sql is applied). */
async function loadLearning(db: Db, userId: string): Promise<LearningContext | null> {
  const { data, error } = await db.rpc("voice_learning_context", { _user_id: userId });
  if (error || !data) return null;
  const list = (v: unknown): LearnedTerm[] => (Array.isArray(v) ? v : []).filter((t) => t && typeof t.term === "string" && typeof t.heard === "string").slice(0, 500);
  return {
    settings: normalizeLearningSettings(data.settings, Object.keys(VOICE_MODELS)),
    defaultModel: isVoiceModel(data.default_model) ? data.default_model : VOICE_MODEL,
    version: typeof data.version === "number" ? data.version : null,
    terms: list(data.terms),
    personal: list(data.personal).slice(0, 60),
    accent: typeof data.accent === "string" ? data.accent : null,
    audioConsent: typeof data.audio_consent === "string" ? data.audio_consent : null,
    routes: (Array.isArray(data.routes) ? data.routes : []).filter((r: RouteRow) => r && isVoiceModel(r.model)),
  };
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
    device: (form.get("device") as string | null) || undefined,
  });
  if (!parsed.success) return fail(400, "bad_fields");
  const { context, interview_id, segment, lang, device } = parsed.data;
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

  const learning = await loadLearning(db, user.id);
  const route = learning
    ? resolveRoute(learning.routes, { language: lang ?? null, device: device ?? null, accent: learning.accent }, learning.settings, learning.defaultModel, isVoiceModel)
    : { model: VOICE_MODEL, reason: "default" as const };
  const model = route.model;

  // Minutes per interview / per day, decided atomically in the database.
  const claim = await db.rpc("voice_claim_segment", { _user_id: user.id, _interview_id: interview_id ?? null, _context: context, _seconds: wav.seconds, _bytes: bytes.length, _segment: segment, _model: model });
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
  const learnedTerms = learning ? [...learning.personal, ...learning.terms] : [];
  // learned words first (the consultant's own, then global ones for their modules), then the usual hints
  const learned = learning ? learnedKeywords(learning.terms, learning.personal, glossaryInput.modules ?? [], 15) : [];
  const keywords = [...new Set([...learned, ...(glossary.keywords.length ? glossary.keywords : SAP_CORE_TERMS)])].slice(0, MAX_KEYWORDS);
  const hints = { prompt: glossary.prompt, keywords, languages: languageHints(lang) };

  // Comparison listening: a share of interview pieces also goes to the other model (only while learning is on).
  const other = Object.keys(VOICE_MODELS).find((m) => m !== model) ?? null;
  const measure = !!(learning?.settings.learning && context === "interview" && other && Math.random() < MEASURE_SHARE);

  const [main, second] = await Promise.all([
    transcribeAudio({ apiKey, model, wav: bytes, hints, signal: req.signal, fileName: `segment-${segment}.wav` }),
    measure ? transcribeAudio({ apiKey, model: other!, wav: bytes, hints, signal: req.signal, fileName: `segment-${segment}.wav` }) : Promise.resolve(null),
  ]);
  if (!main.ok) {
    await finish({ _error: main.error ?? `http_${main.status}` });
    const status = main.status;
    console.warn("voice provider status:", status);
    if (status === 499) return fail(499, "aborted");
    const code = status === 429 ? "rate_limited" : status === 402 ? "credits" : status === 403 ? "provider_denied" : status === 400 ? "bad_audio" : status === 0 ? "provider_unreachable" : "provider_error";
    return fail(status === 429 || status === 402 || status === 403 || status === 400 ? status : 502, code, {}, { ...main.gatewayHeaders, ...(status === 429 ? { "Retry-After": main.retryAfter ?? "20" } : {}) });
  }

  const raw = normalizeArabic(main.text.trim());
  const learnedFix = applyLearnedReplacements(raw, learnedTerms);
  const corrected = settings.post_correct
    ? correctTranscript(learnedFix.text, [...glossary.keywords, ...learnedTerms.map((t) => t.term)])
    : { text: learnedFix.text, changes: [] };
  const allChanges = [...learnedFix.changes.map((c) => ({ from: c.heard, to: c.final })), ...corrected.changes];
  const language = detectLanguage(corrected.text, main.languages.map((code) => ({ code })));

  // Optional audio copies. A failed copy never fails the answer.
  let audioPath: string | null = null;
  if (settings.store_audio && context === "interview" && interview_id) {
    const path = `${interview_id}/${segmentId}.wav`;
    const { error } = await db.storage.from(AUDIO_BUCKET).upload(path, bytes, { contentType: "audio/wav", upsert: false });
    if (!error) audioPath = path; else console.warn("voice audio copy skipped");
  }
  if (learning?.settings.training_audio && learning.audioConsent && context === "interview") {
    const path = `${user.id}/${segmentId}.wav`;
    const { error } = await db.storage.from(TRAINING_BUCKET).upload(path, bytes, { contentType: "audio/wav", upsert: false });
    if (!error) {
      const { data: kept } = await db.rpc("voice_store_training_audio", { _user_id: user.id, _segment_id: segmentId, _path: path, _bytes: bytes.length, _seconds: wav.seconds });
      if (kept !== true) await db.storage.from(TRAINING_BUCKET).remove([path]);
    } else console.warn("voice training copy skipped");
  }

  await finish({
    _status: "ok", _latency_ms: main.latencyMs, _language: language, _corrected: allChanges.length > 0, _seconds: main.seconds ?? wav.seconds, _audio_path: audioPath,
    // raw text kept for the admin audit of interview answers only (dictation text is not kept)
    _raw_text: context === "interview" ? raw.slice(0, 4000) : null,
    _corrections: allChanges.length ? allChanges.slice(0, 40) : null,
  });
  if (learning?.settings.learning && context === "interview" && allChanges.length) {
    const { error } = await db.rpc("voice_record_auto_corrections", {
      _user_id: user.id, _interview_id: interview_id, _source: "rule", _pairs: allChanges.slice(0, 20).map((c) => ({ heard: c.from, final: c.to })),
      _language: lang ?? null, _model: model, _device: device ?? null,
    });
    if (error) console.warn("voice auto pairs skipped:", error.code ?? "error");
  }

  const rawByModel: Record<string, string> = { [model]: raw };
  if (second?.ok) rawByModel[other!] = normalizeArabic(second.text.trim());

  return jsonResponse(req, {
    text: corrected.text,
    raw_text: raw,
    raw_by_model: rawByModel,
    language,
    confidence: null,
    seconds: main.seconds ?? wav.seconds,
    corrected: allChanges.length > 0,
    corrections: allChanges.length,
    latency_ms: main.latencyMs,
    model,
    route: route.reason,
    vocab_version: learning?.version ?? null,
  }, 200, main.gatewayHeaders);
});

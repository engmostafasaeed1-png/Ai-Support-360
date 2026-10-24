// Voice learning worker (docs/interview-voice.md, section "Learning"; docs/sql/interview-voice-learning.sql).
// Woken by the database (voice_learning_wake through pg_net, after the nightly job, an administrator's approval or a
// consultant withdrawing recording consent) only while it has work. Refuses any call without the private x-job-token.
//   1. Regression gate for the candidate vocabulary: the same raw texts (frozen benchmark + recent answers, at most 10
//      per consultant) are corrected with the active and with the candidate vocabulary; the candidate becomes active
//      only when it is not worse. Too few test items: it waits (an administrator may activate it with a reason).
//   2. Gate for proposed model routes: only on the frozen benchmark (texts from both models); without one, blocked.
//   3. Deletes kept training recordings that expired, were withdrawn, belong to deleted accounts or after the setting
//      was turned off.
// Responses contain counts only. No AI calls: everything is text comparison.
import { adminClient, jsonResponse, preflight } from "../_shared/security.ts";
import { isJobCaller } from "../_shared/jobAuth.ts";
import { evaluateModelSwitch, evaluateVocabulary, normalizeLearningSettings, type EvalItem, type LearnedTerm } from "../_shared/voiceLearning.ts";
import { SAP_CORE_TERMS } from "../_shared/voiceGlossary.ts";
import { VOICE_MODELS } from "../_shared/voiceProviders.ts";

const TRAINING_BUCKET = "voice-training";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);
  const db = adminClient();
  if (!(await isJobCaller(req, db))) return jsonResponse(req, { error: "Unauthorized" }, 401);

  const { data: work, error } = await db.rpc("voice_learning_work");
  if (error || !work) return jsonResponse(req, { error: "not_ready" }, 503);
  const settings = normalizeLearningSettings(work.settings, Object.keys(VOICE_MODELS));
  const items: EvalItem[] = (Array.isArray(work.items) ? work.items : []).map((i: Record<string, unknown>) => ({
    reference: String(i.reference ?? ""), raw: String(i.raw ?? ""), user_id: (i.user_id as string) ?? null,
    source: i.source === "benchmark" ? "benchmark" : "live", raws: i.raws && typeof i.raws === "object" ? i.raws as Record<string, string> : undefined,
  }));
  // benchmark items carry one raw text per model: use the default model's text for the vocabulary comparison
  const vocabItems = items.map((i) => (i.source === "benchmark" && !i.raw && i.raws ? { ...i, raw: i.raws["openai/gpt-transcribe"] ?? Object.values(i.raws)[0] ?? "" } : i));
  const counts = { vocab: "none" as string, routes: 0, audio_deleted: 0 };

  if (work.candidate?.version) {
    const active: LearnedTerm[] = Array.isArray(work.active?.terms) ? work.active.terms : [];
    const cand: LearnedTerm[] = Array.isArray(work.candidate.terms) ? work.candidate.terms : [];
    const result = evaluateVocabulary(vocabItems, active, cand, SAP_CORE_TERMS, settings);
    const { data } = await db.rpc("voice_learning_gate_result", { _kind: "vocab", _id: String(work.candidate.version), _eval: result });
    counts.vocab = typeof data === "string" ? data : "error";
  }

  for (const r of Array.isArray(work.routes) ? work.routes : []) {
    const result = evaluateModelSwitch(items, String(r.previous_model ?? ""), String(r.model), settings);
    const { data } = await db.rpc("voice_learning_gate_result", { _kind: "route", _id: String(r.id), _eval: result });
    if (data === "activated" || data === "blocked") counts.routes += 1;
  }

  const audio = (Array.isArray(work.audio) ? work.audio : []) as Array<{ id: string; path: string }>;
  for (let i = 0; i < audio.length; i += 50) {
    const batch = audio.slice(i, i + 50);
    const { error: rmError } = await db.storage.from(TRAINING_BUCKET).remove(batch.map((a) => a.path));
    // a missing file (bucket never created, already gone) counts as deleted; other errors are retried next wake-up
    if (rmError && !/not.?found/i.test(String(rmError.message ?? ""))) { console.warn("voice audio delete failed"); continue; }
    const { data } = await db.rpc("voice_learning_audio_deleted", { _ids: batch.map((a) => a.id) });
    counts.audio_deleted += typeof data === "number" ? data : 0;
  }

  return jsonResponse(req, counts, 200);
});

// Interview voice learning loop (docs/interview-voice.md, docs/sql/interview-voice-learning.sql). Pure (no Deno or
// browser APIs): used by the browser (pairs from a consultant's own edits), voice-transcribe (learned terms in the hints
// and spelling fixes), voice-learning-run (regression gate) and tests.
//
// We cannot retrain the speech model, so the loop learns around it:
//   corrections (heard -> final, max 3 words, PII-filtered, never audio)  ->  nightly suggestions with the number of
//   DIFFERENT consultants  ->  auto-promotion only with >= N consultants + legitimate token + SAP check, else admin
//   review  ->  new vocabulary VERSION (candidate)  ->  regression gate on a frozen text set  ->  active (rollback any time).
// The database decides (voice_learning_nightly and the admin functions); this file mirrors the same rules for display,
// the gate and tests. Keep both in step.
import { alignWords, tokenize, wordErrors } from "./voiceText.ts";
import { correctTranscript, MODULE_TERMS, normalizeModule, SAP_CORE_TERMS } from "./voiceGlossary.ts";

export const LEARNING_SETTINGS_KEY = "interview_voice_learning";

export interface LearningSettings {
  /** Store correction pairs and learn from them (kill switch). */
  learning: boolean;
  /** Promote suggestions automatically when every guard passes (else everything waits for an administrator). */
  auto_promote: boolean;
  /** Different consultants who made the same correction before it can be promoted automatically. */
  promote_min_consultants: number;
  /** Route each new piece to the best measured model for its context (default off until the owner enables it). */
  auto_routing: boolean;
  /** Always use this model (overrides routing). */
  pinned_model: string | null;
  routing_min_answers: number;
  routing_min_words: number;
  routing_min_consultants: number;
  /** A challenger must beat the current model's word error rate by at least this much (0.02 = 2 points). */
  routing_margin: number;
  /** Answers per consultant counted at most per model and context (one person cannot steer routing). */
  routing_user_cap: number;
  /** A new vocabulary or model may be at most this much worse on the test set (0 = must not be worse). */
  regression_tolerance: number;
  /** Test sentences/answers needed before the gate can decide. */
  min_eval_items: number;
  /** Offer the opt-in "keep my recording for 90 days" checkbox and keep consented audio (default off). */
  training_audio: boolean;
  audio_retention_days: number;
  /** Own corrections repeated this often become a personal hint. */
  personal_min_repeats: number;
  personal_max_terms: number;
  question_min_answers: number;
  /** Share of candidates (0.4 = 40 %) that marks a question as misunderstood / skipped. */
  question_flag_rate: number;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  learning: true,
  auto_promote: true,
  promote_min_consultants: 3,
  auto_routing: false,
  pinned_model: null,
  routing_min_answers: 30,
  routing_min_words: 600,
  routing_min_consultants: 3,
  routing_margin: 0.02,
  routing_user_cap: 20,
  regression_tolerance: 0.005,
  min_eval_items: 20,
  training_audio: false,
  audio_retention_days: 90,
  personal_min_repeats: 2,
  personal_max_terms: 30,
  question_min_answers: 10,
  question_flag_rate: 0.4,
};

export const LEARNING_LIMITS = {
  promote_min_consultants: [2, 20],
  routing_min_answers: [10, 1000],
  routing_min_words: [100, 20000],
  routing_min_consultants: [2, 50],
  routing_margin: [0.005, 0.2],
  routing_user_cap: [5, 200],
  regression_tolerance: [0, 0.05],
  min_eval_items: [10, 500],
  audio_retention_days: [1, 90],
  personal_min_repeats: [2, 10],
  personal_max_terms: [5, 100],
  question_min_answers: [5, 200],
  question_flag_rate: [0.1, 0.9],
} as const;

const RATE_KEYS = new Set(["routing_margin", "regression_tolerance", "question_flag_rate"]);

export function normalizeLearningSettings(raw: unknown, allowedModels: readonly string[] = []): LearningSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LEARNING_SETTINGS };
  for (const k of ["learning", "auto_promote", "auto_routing", "training_audio"] as const) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  for (const [k, [lo, hi]] of Object.entries(LEARNING_LIMITS) as Array<[keyof typeof LEARNING_LIMITS, readonly [number, number]]>) {
    const v = typeof o[k] === "number" ? (o[k] as number) : typeof o[k] === "string" && (o[k] as string).trim() !== "" ? Number(o[k]) : NaN;
    if (!Number.isFinite(v)) continue;
    const c = Math.min(hi, Math.max(lo, v));
    (out as Record<string, unknown>)[k] = RATE_KEYS.has(k) ? Math.round(c * 1000) / 1000 : Math.round(c);
  }
  out.pinned_model = typeof o.pinned_model === "string" && (!allowedModels.length || allowedModels.includes(o.pinned_model)) ? o.pinned_model : null;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Privacy filter: what may be stored as a learned word (mirrored by public.voice_term_problem)
// ---------------------------------------------------------------------------------------------------------------
export const MAX_TERM_LENGTH = 40;
export const MAX_TERM_WORDS = 3;

const PROFANITY = ["fuck", "fucking", "shit", "bitch", "bastard", "asshole", "dick", "cunt", "whore", "slut", "كس", "شرموط", "شرموطة", "عرص", "منيك", "خول", "قحبة", "زب"];
const PROMPT_LIKE: readonly RegExp[] = [
  /\b(ignore|disregard|forget)\b.*\b(previous|above|instructions?|rules?)\b/i,
  /\b(system|developer)\s*prompt\b/i,
  /\byou are\b/i,
  /\bact as\b/i,
  /\bjailbreak\b/i,
  /\b(password|passwd|api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|bearer)\b/i,
  /تجاهل|كلمة\s*(السر|المرور)/,
];
const TERM_CHARS = /^[A-Za-z0-9\u0600-\u06FF/][A-Za-z0-9\u0600-\u06FF ._/&+-]*$/;

export type TermProblem = "empty" | "too_short" | "too_long" | "too_many_words" | "url" | "email" | "phone" | "long_number" | "characters" | "secret" | "profanity" | "prompt_like";

/** Collapses spaces and strips punctuation around the word (as stored). */
export function cleanTerm(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().replace(/^[.,;:!?،؛؟"'“”‘’()[\]{}«»]+|[.,;:!?،؛؟"'“”‘’()[\]{}«»]+$/g, "").trim();
}

/** Lookup key for a heard form or a final term: cleaned and lower case (same as public.voice_term_key). */
export function termKey(raw: unknown): string {
  return cleanTerm(raw).toLowerCase();
}

/** Why a word may not be stored or learned, or null when it is a legitimate short token. */
export function termProblem(raw: unknown): TermProblem | null {
  const t = cleanTerm(raw);
  if (!t) return "empty";
  if (t.includes("@")) return "email";
  if (/(https?:\/\/|www\.)|\.(com|net|org|io|sa|eg|ae|co)\b/i.test(t)) return "url";
  if ((t.match(/\d/g) ?? []).length >= 7) return "phone";
  if (/\d{5,}/.test(t)) return "long_number";
  if (t.length < 2) return "too_short";
  if (t.length > MAX_TERM_LENGTH) return "too_long";
  if (t.split(" ").length > MAX_TERM_WORDS) return "too_many_words";
  if (!TERM_CHARS.test(t)) return "characters";
  for (const w of t.split(" ")) {
    if (w.length >= 16 && /[a-z]/.test(w) && /[A-Z]/.test(w) && /\d/.test(w)) return "secret";
    if (/^[0-9a-f]{12,}$/i.test(w) && /\d/.test(w)) return "secret";
  }
  const lower = t.toLowerCase();
  if (lower.split(/[\s._/&+-]+/).some((w) => PROFANITY.includes(w))) return "profanity";
  if (PROMPT_LIKE.some((re) => re.test(t))) return "prompt_like";
  return null;
}

/** Masks personal data and secrets in a longer text before it is kept for the test set (e-mails, links, phone and long
 * numbers, secret-looking tokens). The same masks apply to both sides, so word error rates stay comparable. */
export function scrubText(text: string): string {
  return String(text ?? "")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/(https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/\b(?=[A-Za-z0-9_-]{16,}\b)(?=[^\s]*[a-z])(?=[^\s]*[A-Z])(?=[^\s]*\d)[A-Za-z0-9_-]+\b/g, "[secret]")
    .replace(/\b[0-9a-f]{12,}\b/gi, (m) => (/\d/.test(m) && /[a-f]/i.test(m) ? "[secret]" : m))
    .replace(/\+?\d[\d ().-]{5,}\d/g, "[number]")
    .replace(/\d{5,}/g, "[number]")
    .slice(0, 4000);
}

// ---------------------------------------------------------------------------------------------------------------
// Pairs from one answer: what the consultant changed in the text we showed
// ---------------------------------------------------------------------------------------------------------------
export interface CorrectionPair { heard: string; final: string }

const isTechnicalTerm = (t: string) => /\d|\//.test(t) || (t.match(/[A-Z]/g) ?? []).length >= 2;

/**
 * Word substitutions between the text we showed and the text the consultant sent (at most 3 words a side, both sides
 * pass termProblem). Insertions and deletions are not learned (that is new content, not a mis-heard word); a near-total
 * rewrite is not learned either; case-only changes count only for technical terms ("Miro" -> "MIRO").
 */
export function extractCorrectionPairs(shown: string, final: string, max = 20): CorrectionPair[] {
  const a = String(shown ?? "").trim().split(/\s+/).filter(Boolean);
  const b = String(final ?? "").trim().split(/\s+/).filter(Boolean);
  if (!a.length || !b.length || a.length > 600 || b.length > 600) return [];
  const e = wordErrors(shown, final);
  if (e.reference > 0 && (e.substitutions + e.deletions + e.insertions) / e.reference > 0.6) return [];
  const ops = alignWords(a.map(cleanTerm), b.map(cleanTerm));
  const out: CorrectionPair[] = [];
  const seen = new Set<string>();
  let cur: { from: string[]; to: string[]; tooLong: boolean } | null = null;
  const flush = () => {
    const c = cur;
    cur = null;
    if (!c || c.tooLong || !c.from.length || !c.to.length) return;
    const heard = cleanTerm(c.from.join(" "));
    const fin = cleanTerm(c.to.join(" "));
    if (!heard || !fin || heard === fin) return;
    if (heard.toLowerCase() === fin.toLowerCase() && !isTechnicalTerm(fin)) return;
    if (termProblem(heard) || termProblem(fin)) return;
    const k = `${termKey(heard)}|${termKey(fin)}`;
    if (seen.has(k) || out.length >= max) return;
    seen.add(k);
    out.push({ heard, final: fin });
  };
  for (const op of ops) {
    if (op.op === "eq") { flush(); continue; }
    cur ??= { from: [], to: [], tooLong: false };
    if (op.refIndex != null) cur.from.push(a[op.refIndex]);
    if (op.hypIndex != null) cur.to.push(b[op.hypIndex]);
    if (cur.from.length > MAX_TERM_WORDS || cur.to.length > MAX_TERM_WORDS) cur.tooLong = true;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Aggregation and promotion (mirrors voice_learning_nightly)
// ---------------------------------------------------------------------------------------------------------------
export type PairSource = "consultant" | "rule" | "model";
export interface StoredPair { user_id: string; heard: string; final: string; source: PairSource }
export interface Suggestion { heard_key: string; final_term: string; final_key: string; total: number; consultants: number }

/** Groups pairs by heard form + final term. Only consultants' own edits count as evidence (automatic fixes are ours). */
export function aggregatePairs(pairs: readonly StoredPair[]): Suggestion[] {
  const groups = new Map<string, { heard_key: string; final_key: string; spellings: Map<string, number>; total: number; users: Set<string> }>();
  for (const p of pairs) {
    if (p.source !== "consultant") continue;
    if (termProblem(p.heard) || termProblem(p.final)) continue;
    const hk = termKey(p.heard), fk = termKey(p.final);
    if (!hk || !fk || cleanTerm(p.heard) === cleanTerm(p.final)) continue;
    const k = `${hk}|${fk}`;
    const g = groups.get(k) ?? { heard_key: hk, final_key: fk, spellings: new Map(), total: 0, users: new Set<string>() };
    const spelled = cleanTerm(p.final);
    g.spellings.set(spelled, (g.spellings.get(spelled) ?? 0) + 1);
    g.total += 1;
    g.users.add(p.user_id);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    heard_key: g.heard_key,
    final_key: g.final_key,
    final_term: [...g.spellings.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0],
    total: g.total,
    consultants: g.users.size,
  })).sort((x, y) => y.consultants - x.consultants || y.total - x.total || x.heard_key.localeCompare(y.heard_key));
}

const SAP_PATTERNS: readonly RegExp[] = [
  /^[A-Z]{1,5}\d{1,3}[A-Z]{0,2}$/, // MIRO is letters only; FB60, ME21N, KS01, PC00
  /^\/[A-Z0-9]{2,6}\/[A-Z0-9_]{2,20}$/, // /SCWM/MON
  /^[A-Z]{1,4}-\d{2}$/, // F-02
  /^S\/4\s?HANA\b/i,
  /^[A-Z][A-Z0-9_]{2,15}$/, // ACDOCA, BSEG, SPRO, transaction and table names in capitals
];
const SAP_WORDS = new Set([...SAP_CORE_TERMS, ...Object.values(MODULE_TERMS).flat()].map((t) => t.toLowerCase()));

/** The SAP check: a known SAP term, a T-code / table-like token, or found in the admin vocabulary / knowledge base. */
export function sapTermOk(term: string, knownElsewhere: (key: string) => boolean = () => false): boolean {
  const t = cleanTerm(term);
  if (!t) return false;
  if (SAP_WORDS.has(t.toLowerCase())) return true;
  if (SAP_PATTERNS.some((re) => re.test(t))) return true;
  return knownElsewhere(t.toLowerCase());
}

export type PromotionDecision = "auto_promote" | "review" | "blocked" | "drop";

export function promotionDecision(
  s: { final_term: string; consultants: number; sapOk: boolean; blocked: boolean },
  settings: Pick<LearningSettings, "auto_promote" | "promote_min_consultants" | "learning">,
): PromotionDecision {
  if (s.blocked) return "blocked";
  if (termProblem(s.final_term)) return "drop";
  if (settings.learning && settings.auto_promote && s.consultants >= settings.promote_min_consultants && s.sapOk) return "auto_promote";
  return "review";
}

// ---------------------------------------------------------------------------------------------------------------
// Vocabulary versions
// ---------------------------------------------------------------------------------------------------------------
export interface LearnedTerm { heard: string; term: string; module?: string | null; source?: "auto" | "admin" }
export type VersionStatus = "candidate" | "active" | "retired" | "blocked";
export interface VocabVersion { version: number; status: VersionStatus; activated_at: string | null; terms: LearnedTerm[] }

/** Next term list: a newer term for the same heard form replaces the older one; removed keys drop out. */
export function mergeTerms(active: readonly LearnedTerm[], add: readonly LearnedTerm[], removeHeardKeys: readonly string[] = [], max = 500): LearnedTerm[] {
  const byHeard = new Map<string, LearnedTerm>();
  for (const t of [...active, ...add]) {
    const k = termKey(t.heard);
    if (!k || termProblem(t.term)) continue;
    byHeard.set(k, { heard: cleanTerm(t.heard), term: cleanTerm(t.term), module: t.module ?? null, source: t.source ?? "auto" });
  }
  for (const k of removeHeardKeys) byHeard.delete(termKey(k));
  return [...byHeard.values()].slice(-max);
}

/** Rollback goes only to a version that was active before (so it already passed the gate or an administrator's check). */
export function canRollbackTo(versions: readonly VocabVersion[], target: number): { ok: boolean; reason?: "unknown" | "already_active" | "never_active" } {
  const v = versions.find((x) => x.version === target);
  if (!v) return { ok: false, reason: "unknown" };
  if (v.status === "active") return { ok: false, reason: "already_active" };
  if (!v.activated_at) return { ok: false, reason: "never_active" };
  return { ok: true };
}

export function applyRollback(versions: readonly VocabVersion[], target: number, now = new Date().toISOString()): VocabVersion[] {
  if (!canRollbackTo(versions, target).ok) return [...versions];
  return versions.map((v) => (v.version === target ? { ...v, status: "active", activated_at: now } : v.status === "active" ? { ...v, status: "retired" } : v));
}

// ---------------------------------------------------------------------------------------------------------------
// Using learned terms on new text
// ---------------------------------------------------------------------------------------------------------------
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Direct heard -> term replacements are applied only where they cannot hit ordinary words: technical terms
 * (capitals, digits, slashes), case fixes of technical terms and multi-word heard forms. Others act as hints only. */
export function replacementAllowed(t: LearnedTerm): boolean {
  const heard = cleanTerm(t.heard), term = cleanTerm(t.term);
  if (!heard || !term || termProblem(term) || termProblem(heard)) return false;
  return isTechnicalTerm(term) || heard.includes(" ");
}

export function applyLearnedReplacements(text: string, terms: readonly LearnedTerm[]): { text: string; changes: CorrectionPair[] } {
  let out = String(text ?? "");
  const changes: CorrectionPair[] = [];
  const usable = terms.filter(replacementAllowed).sort((x, y) => cleanTerm(y.heard).length - cleanTerm(x.heard).length);
  for (const t of usable) {
    const body = cleanTerm(t.heard).split(" ").map(escapeRe).join("\\s+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}/_-])${body}(?![\\p{L}\\p{N}/_])`, "giu");
    const term = cleanTerm(t.term);
    out = out.replace(re, (m) => { if (m !== term) changes.push({ heard: m, final: term }); return term; });
  }
  return { text: out, changes };
}

/** The learned part of the speech hints: the consultant's own words first, then global terms for their modules. */
export function learnedKeywords(global: readonly LearnedTerm[], personal: readonly LearnedTerm[], modules: ReadonlyArray<string | null | undefined> = [], max = 15): string[] {
  const fams = new Set(modules.flatMap((m) => normalizeModule(m)));
  const moduleMatch = (t: LearnedTerm) => (t.module ? normalizeModule(t.module).some((f) => fams.has(f)) : false);
  const ordered = [...personal, ...global.filter(moduleMatch), ...global.filter((t) => !moduleMatch(t))];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of ordered) {
    const term = cleanTerm(t.term);
    if (!term || termProblem(term) || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** A consultant's own repeated corrections (count >= personal_min_repeats), most frequent first. */
export function personalTermsFrom(pairs: ReadonlyArray<CorrectionPair>, blockedKeys: ReadonlySet<string>, settings: Pick<LearningSettings, "personal_min_repeats" | "personal_max_terms">): Array<LearnedTerm & { count: number }> {
  const counts = new Map<string, { heard: string; term: string; count: number }>();
  for (const p of pairs) {
    if (termProblem(p.heard) || termProblem(p.final) || blockedKeys.has(termKey(p.final))) continue;
    const k = `${termKey(p.heard)}|${termKey(p.final)}`;
    const c = counts.get(k) ?? { heard: cleanTerm(p.heard), term: cleanTerm(p.final), count: 0 };
    c.count += 1;
    counts.set(k, c);
  }
  return [...counts.values()].filter((c) => c.count >= settings.personal_min_repeats)
    .sort((x, y) => y.count - x.count || x.term.localeCompare(y.term)).slice(0, settings.personal_max_terms)
    .map((c) => ({ heard: c.heard, term: c.term, count: c.count, source: "auto" as const }));
}

// ---------------------------------------------------------------------------------------------------------------
// Regression gate (text level: no audio needed)
// ---------------------------------------------------------------------------------------------------------------
export interface EvalItem { reference: string; raw: string; user_id?: string | null; source: "benchmark" | "live"; raws?: Record<string, string> }
export interface GateResult { items: number; wer_before: number | null; wer_after: number | null; delta: number | null; passed: boolean | null; reason: "passed" | "worse" | "not_enough_items" }

/** At most `cap` live items per consultant, benchmark items always kept. */
export function capLiveItems(items: readonly EvalItem[], cap = 10): EvalItem[] {
  const per = new Map<string, number>();
  return items.filter((i) => {
    if (i.source === "benchmark") return true;
    const k = i.user_id ?? "?";
    const n = per.get(k) ?? 0;
    if (n >= cap) return false;
    per.set(k, n + 1);
    return true;
  });
}

/** Pooled word error rate (all errors / all reference words), steadier than the mean of per-item rates. */
export function pooledWer(pairs: ReadonlyArray<{ reference: string; hypothesis: string }>): number | null {
  let words = 0, errs = 0;
  for (const p of pairs) {
    const e = wordErrors(p.reference, p.hypothesis);
    words += e.reference;
    errs += e.substitutions + e.deletions + e.insertions;
  }
  return words ? Math.round((errs / words) * 10000) / 10000 : null;
}

export function applyVocabulary(text: string, terms: readonly LearnedTerm[], baseGlossary: readonly string[]): string {
  const replaced = applyLearnedReplacements(text, terms).text;
  return correctTranscript(replaced, [...baseGlossary, ...terms.map((t) => cleanTerm(t.term))]).text;
}

export function gate(before: number | null, after: number | null, items: number, s: Pick<LearningSettings, "regression_tolerance" | "min_eval_items">): GateResult {
  if (items < s.min_eval_items || before == null || after == null) return { items, wer_before: before, wer_after: after, delta: null, passed: null, reason: "not_enough_items" };
  const delta = Math.round((after - before) * 10000) / 10000;
  const passed = after <= before + s.regression_tolerance;
  return { items, wer_before: before, wer_after: after, delta, passed, reason: passed ? "passed" : "worse" };
}

/** Candidate vocabulary vs the active one on the same raw texts. */
export function evaluateVocabulary(items: readonly EvalItem[], active: readonly LearnedTerm[], candidate: readonly LearnedTerm[], baseGlossary: readonly string[], s: Pick<LearningSettings, "regression_tolerance" | "min_eval_items">): GateResult {
  const set = capLiveItems(items).filter((i) => tokenize(i.reference).length > 0 && i.raw.trim());
  const before = pooledWer(set.map((i) => ({ reference: i.reference, hypothesis: applyVocabulary(i.raw, active, baseGlossary) })));
  const after = pooledWer(set.map((i) => ({ reference: i.reference, hypothesis: applyVocabulary(i.raw, candidate, baseGlossary) })));
  return gate(before, after, set.length, s);
}

/** A model switch on the frozen benchmark (items that have raw text from both models). */
export function evaluateModelSwitch(items: readonly EvalItem[], from: string, to: string, s: Pick<LearningSettings, "regression_tolerance" | "min_eval_items">): GateResult {
  const set = items.filter((i) => i.source === "benchmark" && i.raws && typeof i.raws[from] === "string" && typeof i.raws[to] === "string");
  const before = pooledWer(set.map((i) => ({ reference: i.reference, hypothesis: i.raws![from] })));
  const after = pooledWer(set.map((i) => ({ reference: i.reference, hypothesis: i.raws![to] })));
  return gate(before, after, set.length, s);
}

/** Current consent text version for the opt-in training recording checkbox. */
export const AUDIO_CONSENT_VERSION = "2026-10-24";

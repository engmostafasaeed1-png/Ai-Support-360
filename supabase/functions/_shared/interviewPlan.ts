// Interview plan builder for the AI interviewer (knowledge-based, profile-specific questions).
// Pure functions only (no Deno or browser APIs): the edge functions, the admin preview and vitest use the same file.
//
// A plan is a list of (module, version, weight, number of questions, difficulty) built from the consultant's declared
// profile before the first question, plus question "slots" (kind, version-specific or not) that the generator fills.

export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type QuestionKind = "scenario" | "troubleshooting" | "design" | "technical" | "soft_skill" | "version_warmup";
export type VersionSource = "profile" | "inferred" | "ask";

export interface PlanSkill {
  module: string;
  version: string | null;
  years: number | null;
  proficiency: number | null; // 1-5
  certified: boolean;
}

export interface PlanProject {
  modules: string[];
  durationMonths: number | null;
}

export interface PlanProfile {
  skills: PlanSkill[];
  seniority: string | null;
  totalYears: number | null;
  technologies: string[];
  deployment: string[];
  projectTypes: string[];
  projects: PlanProject[];
  cvSummary: string | null;
}

export interface PlanOptions {
  /** Questions per module, at least. */
  minPerModule: number;
  /** Questions per module, at most. */
  maxPerModule: number;
  /** Main questions aimed for (warm-ups and the soft-skill question come on top). */
  totalQuestions: number;
  /** Modules covered at most; the weakest ones beyond this are listed as `uncovered`. */
  maxModules: number;
}

export interface PlanItem {
  module: string;
  version: string | null;
  versionSource: VersionSource;
  weight: number;
  questions: number;
  difficulty: Difficulty;
  years: number | null;
  proficiency: number | null;
  certified: boolean;
}

export interface InterviewPlan {
  items: PlanItem[];
  uncovered: string[];
  baseDifficulty: Difficulty;
  totalQuestions: number;
}

export interface QuestionSlot {
  slot: number;
  module: string | null;
  version: string | null;
  kind: QuestionKind;
  versionSpecific: boolean;
  difficulty: Difficulty;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { minPerModule: 1, maxPerModule: 3, totalQuestions: 8, maxModules: 8 };
export const HARD_LIMITS = { minPerModule: [0, 3], maxPerModule: [1, 6], totalQuestions: [3, 16], maxModules: [1, 12] } as const;

const LEVELS: Difficulty[] = ["easy", "medium", "hard", "expert"];
const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Settings from the admin page, made safe (bounds, max >= min). */
export function normalizePlanOptions(raw: Partial<Record<keyof PlanOptions, unknown>> | null | undefined): PlanOptions {
  const r = raw ?? {};
  const minPerModule = clampInt(r.minPerModule, HARD_LIMITS.minPerModule[0], HARD_LIMITS.minPerModule[1], DEFAULT_PLAN_OPTIONS.minPerModule);
  const maxPerModule = Math.max(minPerModule, clampInt(r.maxPerModule, HARD_LIMITS.maxPerModule[0], HARD_LIMITS.maxPerModule[1], DEFAULT_PLAN_OPTIONS.maxPerModule));
  return {
    minPerModule,
    maxPerModule,
    totalQuestions: clampInt(r.totalQuestions, HARD_LIMITS.totalQuestions[0], HARD_LIMITS.totalQuestions[1], DEFAULT_PLAN_OPTIONS.totalQuestions),
    maxModules: clampInt(r.maxModules, HARD_LIMITS.maxModules[0], HARD_LIMITS.maxModules[1], DEFAULT_PLAN_OPTIONS.maxModules),
  };
}

/** "SAP FI", "fi", " S/4HANA Finance " → comparable keys. */
export function moduleKey(name: string): string {
  return String(name || "").toLowerCase().replace(/^sap\s+/, "").replace(/[^a-z0-9/\u0600-\u06ff]+/g, " ").trim();
}

function sameModule(a: string, b: string): boolean {
  const x = moduleKey(a), y = moduleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "fi" must not match "fiori": only whole-word containment counts
  const words = (s: string) => ` ${s} `;
  return words(x).includes(words(y)) || words(y).includes(words(x));
}

/** A release named in the module itself ("SAP ECC 6.0", "S/4HANA 2023 FPS01"). */
export function inferVersion(module: string): string | null {
  const s = String(module || "");
  const ecc = s.match(/\bECC\s*6(?:\.0)?(?:\s*EHP\s*\d{1,2})?/i);
  if (ecc) return ecc[0].replace(/\s+/g, " ").replace(/^ecc/i, "ECC").replace(/ehp/i, "EHP").trim();
  const s4 = s.match(/\bS\/?4\s*HANA(?:\s*Cloud)?\s*(\d{4}(?:\s*FPS\s*\d{1,2})?)/i);
  if (s4) return `S/4HANA ${s4[1].replace(/\s+/g, " ").toUpperCase()}`;
  const ver = s.match(/\b(?:release|version|v)\s*(\d{1,4}(?:\.\d{1,3})?)\b/i);
  return ver ? ver[1] : null;
}

/** Base difficulty from the seniority level (or total SAP years when no level is set). */
export function baseDifficulty(seniority: string | null, totalYears: number | null): Difficulty {
  const s = String(seniority || "").toLowerCase();
  if (s === "junior") return "easy";
  if (s === "mid") return "medium";
  if (s === "senior") return "hard";
  if (s === "lead" || s === "principal" || s === "expert") return "expert";
  const y = Number(totalYears);
  if (!Number.isFinite(y) || totalYears === null) return "medium";
  return y < 3 ? "easy" : y < 6 ? "medium" : y < 10 ? "hard" : "expert";
}

function shift(level: Difficulty, by: number): Difficulty {
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(level) + by))];
}

/** Module difficulty: the base level, one lower for a light module, one higher for a deep one. */
export function moduleDifficulty(base: Difficulty, skill: Pick<PlanSkill, "years" | "proficiency">): Difficulty {
  const y = Number(skill.years ?? 0), p = Number(skill.proficiency ?? 3);
  if (y < 2 && p <= 2) return shift(base, -1);
  if (y >= 10 && p >= 5) return shift(base, 1);
  return base;
}

/** How often the module appears in the consultant's projects (count + months), 0..1. */
export function usageScore(module: string, projects: PlanProject[]): number {
  let count = 0, months = 0;
  for (const p of projects || []) {
    if ((p.modules || []).some((m) => sameModule(m, module))) {
      count += 1;
      months += Math.max(0, Number(p.durationMonths) || 0);
    }
  }
  return Math.min(1, (count + months / 12) / 4);
}

/**
 * Weight of a module: years (35 %), proficiency (30 %), how often it was used in projects (25 %), certified (10 %).
 * Always between 0.05 and 1, rounded to 3 decimals, so the same profile gives the same plan.
 */
export function moduleWeight(skill: PlanSkill, projects: PlanProject[]): number {
  const years = Math.min(15, Math.max(0, Number(skill.years) || 0)) / 15;
  const prof = skill.proficiency == null ? 0.5 : (Math.min(5, Math.max(1, Number(skill.proficiency))) - 1) / 4;
  const w = 0.35 * years + 0.3 * prof + 0.25 * usageScore(skill.module, projects) + 0.1 * (skill.certified ? 1 : 0);
  return Math.round(Math.max(0.05, Math.min(1, w)) * 1000) / 1000;
}

/** Builds the plan. Every covered module gets at least `minPerModule`, the strongest ones get more, up to `maxPerModule`. */
export function buildInterviewPlan(profile: PlanProfile, rawOptions?: Partial<PlanOptions>): InterviewPlan {
  const o = normalizePlanOptions(rawOptions ?? {});
  const base = baseDifficulty(profile.seniority, profile.totalYears);
  const seen = new Set<string>();
  const skills = (profile.skills || []).filter((s) => {
    const k = moduleKey(s.module);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const weighted = skills
    .map((s) => ({ s, w: moduleWeight(s, profile.projects || []) }))
    .sort((a, b) => b.w - a.w || moduleKey(a.s.module).localeCompare(moduleKey(b.s.module)));
  const covered = weighted.slice(0, o.maxModules);
  const uncovered = weighted.slice(o.maxModules).map((x) => x.s.module);

  const counts = covered.map(() => o.minPerModule);
  const capacity = covered.length * o.maxPerModule;
  const target = Math.min(capacity, Math.max(o.totalQuestions, covered.length * o.minPerModule));
  let used = counts.reduce((a, b) => a + b, 0);
  // Highest-averages allocation: the next question goes to the module with the largest weight / (questions + 1)
  while (used < target) {
    let best = -1, bestScore = -1;
    covered.forEach((c, i) => {
      if (counts[i] >= o.maxPerModule) return;
      const score = c.w / (counts[i] + 1);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) break;
    counts[best] += 1;
    used += 1;
  }

  const items: PlanItem[] = covered.map(({ s, w }, i) => {
    const explicit = (s.version || "").trim().slice(0, 60) || null;
    const inferred = explicit ? null : inferVersion(s.module);
    return {
      module: s.module.trim().slice(0, 120),
      version: explicit ?? inferred,
      versionSource: explicit ? "profile" : inferred ? "inferred" : "ask",
      weight: w,
      questions: counts[i],
      difficulty: moduleDifficulty(base, s),
      years: s.years ?? null,
      proficiency: s.proficiency ?? null,
      certified: !!s.certified,
    };
  });
  // With a minimum of 0 a weak module can end with no question: it is then reported as not covered.
  const asked = items.filter((it) => it.questions > 0);
  const skipped = items.filter((it) => it.questions === 0).map((it) => it.module);
  return { items: asked, uncovered: [...skipped, ...uncovered], baseDifficulty: base, totalQuestions: asked.reduce((a, b) => a + b.questions, 0) };
}

// ---------------------------------------------------------------------------------------------------------------
// Variety: seeded shuffles so two consultants (or two sessions) never get identical sets, but a given session is stable.

/** cyrb53: small, fast, deterministic string hash (53 bits). */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function seededRandom(seed: string): () => number {
  let a = hash53(seed) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(list: readonly T[], seed: string): T[] {
  const out = [...list];
  const rnd = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Normalised text for "same question" checks: case, punctuation, spacing and SAP prefixes do not matter. */
export function normalizeQuestion(text: string): string {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[\[[^\]]{0,140}\]\]/g, " ")
    .replace(/[^\p{L}\p{N}\s/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Id stored for every asked question (interview_question_log.question_hash), so a consultant never gets it again. */
export function questionHash(text: string): string {
  return hash53(normalizeQuestion(text)).toString(16).padStart(14, "0");
}

export function isRepeat(text: string, asked: ReadonlySet<string>): boolean {
  return asked.has(questionHash(text));
}

/** Candidates that this consultant has not been asked before, without duplicates among themselves. */
export function freshQuestions<T extends { question: string }>(candidates: readonly T[], asked: ReadonlySet<string>): T[] {
  const seen = new Set(asked);
  const out: T[] = [];
  for (const c of candidates) {
    const h = questionHash(c.question);
    if (!normalizeQuestion(c.question) || seen.has(h)) continue;
    seen.add(h);
    out.push(c);
  }
  return out;
}

const KINDS: QuestionKind[] = ["scenario", "troubleshooting", "design", "technical"];

/**
 * The question slots for a plan: version warm-ups first (modules without a release), then the main questions per module
 * (kinds rotated from a seeded order), then exactly one soft-skill question. The first slot of every module with a known
 * release is version-specific.
 */
export function questionSlots(plan: InterviewPlan, seed: string): QuestionSlot[] {
  const slots: QuestionSlot[] = [];
  for (const it of plan.items) {
    if (it.versionSource === "ask") {
      slots.push({ slot: 0, module: it.module, version: null, kind: "version_warmup", versionSpecific: false, difficulty: "easy" });
    }
  }
  for (const it of plan.items) {
    const kinds = seededShuffle(KINDS, `${seed}|${moduleKey(it.module)}`);
    for (let q = 0; q < it.questions; q++) {
      slots.push({
        slot: 0,
        module: it.module,
        version: it.version,
        kind: kinds[q % kinds.length],
        // a module whose release comes from the warm-up answer gets its version-specific question at interview time
        versionSpecific: q === 0,
        difficulty: it.difficulty,
      });
    }
  }
  slots.push({ slot: 0, module: null, version: null, kind: "soft_skill", versionSpecific: false, difficulty: plan.baseDifficulty });
  return slots.map((s, i) => ({ ...s, slot: i + 1 }));
}

/** Modules with a known release that have no version-specific question in the generated set. */
export function missingVersionQuestions(
  plan: InterviewPlan,
  questions: ReadonlyArray<{ module: string | null; version_specific: boolean }>,
): string[] {
  return plan.items
    .filter((it) => it.version && it.questions > 0)
    .filter((it) => !questions.some((q) => q.module && sameModule(q.module, it.module) && q.version_specific))
    .map((it) => it.module);
}

const INDUSTRIES = ["discrete manufacturing", "retail", "pharma", "utilities", "public sector", "oil and gas", "consumer goods", "logistics", "banking", "automotive"];
const COUNTRIES = ["Germany", "Saudi Arabia", "United Arab Emirates", "Egypt", "India", "United States", "United Kingdom", "Netherlands", "Qatar", "Spain"];
const MOMENTS = ["month-end close", "year-end close", "hypercare after go-live", "upgrade cutover weekend", "a new company code rollout", "an audit request", "a performance complaint from the business"];

/** Scenario parameters picked from the seed, so scenarios differ between consultants and sessions. */
export function scenarioParameters(seed: string): { industry: string; country: string; moment: string; companyCodes: number; users: number } {
  const rnd = seededRandom(`scenario|${seed}`);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  return { industry: pick(INDUSTRIES), country: pick(COUNTRIES), moment: pick(MOMENTS), companyCodes: 2 + Math.floor(rnd() * 11), users: [80, 250, 600, 1500, 4000][Math.floor(rnd() * 5)] };
}

/** Short version warm-up question, in English or Arabic (SAP terms stay in English). */
export function versionWarmup(module: string, lang: string): string {
  const k = moduleKey(module);
  const example = /successfactors|sf |employee central/.test(k) ? "the 1H/2H release you use" : /btp|integration|cpi|cap/.test(k) ? "Neo or Cloud Foundry, and which services" : /ecc|r\/3/.test(k) ? "ECC 6.0 EHP7 or EHP8" : "ECC 6.0 EHP8 or S/4HANA 2022/2023";
  if (lang.startsWith("ar")) return `قبل أن نبدأ في ${module}: ما هو الإصدار (release) الذي عملت عليه مؤخرًا، مثل ${example}؟`;
  return `Before we go into ${module}: which release have you worked with most recently, for example ${example}?`;
}

/** Plan summary for screens and prompts: "FI (S/4HANA 2023)", "MM (release to be asked)". */
export function planLabel(it: Pick<PlanItem, "module" | "version" | "versionSource">): string {
  return it.version ? `${it.module} (${it.version})` : it.module;
}

// ---------------------------------------------------------------------------------------------------------------
// Plan question tags. The interviewer starts every message that asks a planned question with [[q: N]]; the screen hides
// the tag, the evaluation uses it to store where the question came from (interview_answers.question_source).

const PLAN_TAG = /\[\[q:\s*(\d{1,2})\s*\]\]/i;

export function extractPlanTag(text: string): number | null {
  const m = String(text || "").match(PLAN_TAG);
  return m ? Number(m[1]) : null;
}

export function stripPlanTags(text: string): string {
  return String(text || "").replace(/\[\[q:\s*\d{0,2}\s*\]\]\s*/gi, "");
}

/** The admin preview's sample: the first question of each module (strongest first), then more, then the soft-skill one. */
export function sampleSlots(slots: readonly QuestionSlot[], n: number): QuestionSlot[] {
  const main = slots.filter((s) => s.kind !== "version_warmup" && s.kind !== "soft_skill");
  const first = main.filter((s, i) => main.findIndex((x) => x.module === s.module) === i);
  const rest = main.filter((s) => !first.includes(s));
  const soft = slots.filter((s) => s.kind === "soft_skill").slice(0, 1);
  return [...first, ...rest].slice(0, Math.max(0, n - soft.length)).concat(soft).sort((a, b) => a.slot - b.slot);
}

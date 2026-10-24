// Model self-selection for interview speech-to-text (docs/sql/interview-voice-learning.sql: voice_learning_nightly
// writes the routing table with the same rules; voice-transcribe reads it with resolveRoute). Pure, tested.
//
// Word error rate per model is measured as the edit distance between each model's raw text and the text the consultant
// finally sent. A model takes over a context only when every model compared has enough answers, words and different
// consultants, and the challenger beats the current model by a safety margin; otherwise the current model stays, so a
// small or noisy sample can never make routing flip back and forth. Each consultant counts at most `routing_user_cap`
// answers, so one person cannot steer routing. A switch then still has to pass the benchmark gate before it is used.

export interface ModelStat { model: string; answers: number; words: number; errors: number; consultants: number }
export interface RouteConfig { routing_min_answers: number; routing_min_words: number; routing_min_consultants: number; routing_margin: number }
export type RouteReason = "not_enough_data" | "current_not_measured" | "keep_current" | "better" | "current_unavailable";

export const statWer = (s: ModelStat) => (s.words > 0 ? s.errors / s.words : 1);

export function decideRoute(
  stats: readonly ModelStat[], current: string | null, fallback: string, cfg: RouteConfig, allowed: (model: string) => boolean = () => true,
): { model: string; changed: boolean; reason: RouteReason; best: string | null } {
  const cur = current && allowed(current) ? current : fallback;
  const unavailable = !!current && cur !== current;
  const eligible = stats.filter((s) => allowed(s.model) && s.answers >= cfg.routing_min_answers && s.words >= cfg.routing_min_words && s.consultants >= cfg.routing_min_consultants);
  const result = (model: string, reason: RouteReason, best: string | null = null) => ({ model, changed: model !== current, reason: unavailable && reason !== "better" ? "current_unavailable" as const : reason, best });
  if (eligible.length < 2) return result(cur, "not_enough_data");
  const curStat = eligible.find((s) => s.model === cur);
  if (!curStat) return result(cur, "current_not_measured");
  const best = [...eligible].sort((a, b) => statWer(a) - statWer(b) || (a.model === cur ? -1 : b.model === cur ? 1 : a.model.localeCompare(b.model)))[0];
  if (best.model !== cur && statWer(best) + cfg.routing_margin < statWer(curStat)) return result(best.model, "better", best.model);
  return result(cur, "keep_current", best.model);
}

export interface AnswerSample { user_id: string; model: string; words: number; errors: number }

/** Totals per model with at most `cap` answers per consultant and model (samples newest first). */
export function capPerUser(samples: readonly AnswerSample[], cap: number): ModelStat[] {
  const used = new Map<string, number>();
  const by = new Map<string, { answers: number; words: number; errors: number; users: Set<string> }>();
  for (const s of samples) {
    const k = `${s.model}|${s.user_id}`;
    const n = used.get(k) ?? 0;
    if (n >= cap || s.words <= 0) continue;
    used.set(k, n + 1);
    const g = by.get(s.model) ?? { answers: 0, words: 0, errors: 0, users: new Set<string>() };
    g.answers += 1;
    g.words += s.words;
    g.errors += Math.min(s.errors, s.words * 3);
    g.users.add(s.user_id);
    by.set(s.model, g);
  }
  return [...by.entries()].map(([model, g]) => ({ model, answers: g.answers, words: g.words, errors: g.errors, consultants: g.users.size }));
}

export interface RouteRow { language: string; device: string; accent: string; model: string; status?: string }
export interface RouteContext { language: string | null; device: string | null; accent: string | null }

/** Interview language as a routing key ("ar-SA" -> "ar", unknown -> "*"). */
export const routeLanguage = (lang: string | null | undefined) => {
  const p = String(lang || "").toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2}$/.test(p) ? p : "*";
};

/** The model for a new piece: pinned model, else (when auto-routing is on) the most specific active route, else default. */
export function resolveRoute(
  table: readonly RouteRow[], ctx: RouteContext, s: { auto_routing: boolean; pinned_model: string | null }, defaultModel: string, allowed: (m: string) => boolean = () => true,
): { model: string; reason: "pinned" | "auto_off" | "routed" | "default" } {
  if (s.pinned_model && allowed(s.pinned_model)) return { model: s.pinned_model, reason: "pinned" };
  if (!s.auto_routing) return { model: defaultModel, reason: "auto_off" };
  const l = routeLanguage(ctx.language), d = ctx.device || "*", a = ctx.accent || "*";
  const order: Array<[string, string, string]> = [[l, d, a], [l, d, "*"], [l, "*", a], [l, "*", "*"], ["*", "*", "*"]];
  for (const [lang, dev, acc] of order) {
    const row = table.find((r) => r.language === lang && r.device === dev && r.accent === acc && (r.status ?? "active") === "active");
    if (row && allowed(row.model)) return { model: row.model, reason: "routed" };
  }
  return { model: defaultModel, reason: "default" };
}

/** Coarse device class from the browser's user agent (no fingerprint): "desktop-chrome", "mobile-safari"… */
export function deviceClass(ua: string | null | undefined): string {
  const u = String(ua || "");
  const form = /iPad|Tablet/i.test(u) ? "tablet" : /Mobi|Android|iPhone/i.test(u) ? "mobile" : "desktop";
  const browser = /Edg\//.test(u) ? "edge" : /SamsungBrowser/.test(u) ? "samsung" : /Firefox\//.test(u) ? "firefox" : /Chrome\/|CriOS/.test(u) ? "chrome" : /Safari\//.test(u) ? "safari" : "other";
  return `${form}-${browser}`;
}

export const ACCENT_GROUPS = ["egyptian", "gulf", "levantine", "maghrebi", "iraqi", "indian", "pakistani", "british", "american", "european", "african", "other"] as const;
export type AccentGroup = typeof ACCENT_GROUPS[number];
export const isAccentGroup = (v: unknown): v is AccentGroup => typeof v === "string" && (ACCENT_GROUPS as readonly string[]).includes(v);

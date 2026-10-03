// Types and helpers for the "possible solutions" card on the New Request screen (edge function ai-suggest).

export type SuggestionBasis = 'knowledge_base' | 'past_case' | 'playbook' | 'general';
export type SuggestionConfidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  title: string;
  summary: string;
  steps: string[];
  tcodes: string[];
  confidence: SuggestionConfidence;
  basis: SuggestionBasis;
  source_ids: string[];
}

export interface SuggestSource {
  id: string;
  kind: 'article' | 'solution' | 'playbook';
  title: string;
}

export interface SuggestResult {
  enabled: boolean;
  mode: 'knowledge' | 'general';
  suggestions: Suggestion[];
  sources: SuggestSource[];
  note: string;
}

export const BASIS_LABEL: Record<SuggestionBasis, string> = {
  knowledge_base: 'Knowledge base article',
  past_case: 'Solved case (anonymous)',
  playbook: 'Playbook',
  general: 'General SAP guidance',
};

export const MIN_DESCRIPTION_FOR_SUGGESTIONS = 20;

const BASES: SuggestionBasis[] = ['knowledge_base', 'past_case', 'playbook', 'general'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown, max: number, each: number): string[] {
  return (Array.isArray(value) ? value : []).map(v => text(v, each)).filter(Boolean).slice(0, max);
}

/** Reads whatever the server sent and returns a bounded, safe shape. It never throws. */
export function normalizeSuggestResult(raw: unknown): SuggestResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const suggestions: Suggestion[] = [];
  for (const s of (Array.isArray(r.suggestions) ? r.suggestions : []).slice(0, 4)) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const title = text(o.title, 140);
    const steps = list(o.steps, 8, 300);
    if (!title || steps.length === 0) continue;
    suggestions.push({
      title,
      summary: text(o.summary, 600),
      steps,
      tcodes: list(o.tcodes, 8, 20),
      confidence: o.confidence === 'high' || o.confidence === 'low' ? o.confidence : 'medium',
      basis: BASES.includes(o.basis as SuggestionBasis) ? (o.basis as SuggestionBasis) : 'general',
      source_ids: (Array.isArray(o.source_ids) ? o.source_ids : []).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 10),
    });
  }
  const sources: SuggestSource[] = [];
  for (const s of (Array.isArray(r.sources) ? r.sources : []).slice(0, 10)) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const kind = o.kind === 'article' || o.kind === 'playbook' ? o.kind : 'solution';
    if (typeof o.id === 'string' && UUID.test(o.id)) sources.push({ id: o.id, kind, title: text(o.title, 160) });
  }
  return {
    enabled: r.enabled !== false,
    mode: r.mode === 'knowledge' ? 'knowledge' : 'general',
    suggestions,
    sources,
    note: text(r.note, 300),
  };
}

export interface SuggestInput {
  title: string;
  description: string;
  areas: string[];
  other: string;
  details: string;
  language: string;
}

/** The same draft gives the same key, so the card does not ask twice. */
export function suggestSignature(input: SuggestInput): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return JSON.stringify([norm(input.title), norm(input.description), input.areas.map(norm), norm(input.other), norm(input.details), input.language]);
}

export function canSuggest(description: string): boolean {
  return description.trim().length >= MIN_DESCRIPTION_FOR_SUGGESTIONS;
}

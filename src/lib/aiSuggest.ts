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

/** An SAP Note that a reviewed source cites. The link opens SAP for Me, which asks for the reader's own SAP login. */
export interface SapNoteRef {
  number: string;
  url: string;
}

/** A discussion on SAP Community: title and link only, the answers stay on SAP's website. */
export interface CommunityItem {
  title: string;
  url: string;
  solved: boolean;
}

export interface SuggestReferences {
  /** SAP Community's own search page with a few generic words from the request. */
  communitySearchUrl: string | null;
  /** True when an administrator switched the live SAP Community look-up on. */
  communityEnabled: boolean;
  community: CommunityItem[];
}

export interface SuggestResult {
  enabled: boolean;
  mode: 'knowledge' | 'general';
  suggestions: Suggestion[];
  sources: SuggestSource[];
  note: string;
  notes: SapNoteRef[];
  references: SuggestReferences;
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
const NOTE_NUMBER = /^\d{5,8}$/;
const COMMUNITY_LINK = /^https:\/\/community\.sap\.com\/[^\s"'<>]*$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown, max: number, each: number): string[] {
  return (Array.isArray(value) ? value : []).map(v => text(v, each)).filter(Boolean).slice(0, max);
}

function obj(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

/** The address of a note in SAP for Me. It is built here from the number, never taken from the server's text. */
export function sapNoteLink(number: string): string {
  return `https://me.sap.com/notes/${number}`;
}

/** Reads whatever the server sent and returns a bounded, safe shape. It never throws. */
export function normalizeSuggestResult(raw: unknown): SuggestResult {
  const r = obj(raw);
  const suggestions: Suggestion[] = [];
  for (const s of (Array.isArray(r.suggestions) ? r.suggestions : []).slice(0, 4)) {
    const o = obj(s);
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
    const o = obj(s);
    const kind = o.kind === 'article' || o.kind === 'playbook' ? o.kind : 'solution';
    if (typeof o.id === 'string' && UUID.test(o.id)) sources.push({ id: o.id, kind, title: text(o.title, 160) });
  }
  const notes: SapNoteRef[] = [];
  for (const n of (Array.isArray(r.notes) ? r.notes : []).slice(0, 20)) {
    if (notes.length >= 5) break;
    const number = text(obj(n).number, 8);
    if (NOTE_NUMBER.test(number) && !notes.some(x => x.number === number)) notes.push({ number, url: sapNoteLink(number) });
  }
  const refs = obj(r.references);
  const live = obj(refs.community);
  const community: CommunityItem[] = [];
  for (const c of (Array.isArray(live.items) ? live.items : []).slice(0, 20)) {
    if (community.length >= 3) break;
    const o = obj(c);
    const title = text(o.title, 140);
    const url = typeof o.url === 'string' ? o.url : '';
    if (title && url.length <= 600 && COMMUNITY_LINK.test(url)) community.push({ title, url, solved: o.solved === true });
  }
  const searchUrl = typeof refs.community_search_url === 'string' ? refs.community_search_url : '';
  return {
    enabled: r.enabled !== false,
    mode: r.mode === 'knowledge' ? 'knowledge' : 'general',
    suggestions,
    sources,
    note: text(r.note, 400),
    notes,
    references: {
      communitySearchUrl: searchUrl.length <= 400 && COMMUNITY_LINK.test(searchUrl) ? searchUrl : null,
      communityEnabled: live.enabled === true,
      community,
    },
  };
}

/** True when the card has at least one link to an SAP website to show. */
export function hasReferences(result: SuggestResult): boolean {
  return result.notes.length > 0 || result.references.community.length > 0 || !!result.references.communitySearchUrl;
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

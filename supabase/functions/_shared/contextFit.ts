import { familyOf, isOther, regionOfCountry, segmentFamily } from './profileTaxonomy.ts';

/**
 * Deterministic "context fit" between what a request says (industry, customer segment, country, project type, vertical and localization
 * solutions) and what a consultant has done. It never calls the AI model: the same inputs always give the same score, and every point can be
 * explained to the client ("why matched").
 * Only the criteria the request actually states count: if the request says nothing, the score is null and the matching ignores this criterion.
 */
export type RequestContext = {
  industry?: string | null;
  customer_segment?: string | null;
  country?: string | null;
  project_type?: string | null;
  vertical_solutions?: string[] | null;
  localization_solutions?: string[] | null;
};

export type ConsultantContext = {
  industries?: string[] | null;
  customer_segments?: string[] | null;
  vertical_solutions?: string[] | null;
  localization_countries?: string[] | null;
  onsite_countries?: string[] | null;
  localization_solutions?: string[] | null;
  project_types?: string[] | null;
};

export const CONTEXT_WEIGHTS = {
  industry: 25,
  customer_segment: 20,
  country: 20,
  vertical: 15,
  localization_solution: 10,
  project_type: 10,
} as const;

export type ContextFit = { score: number | null; matches: string[]; gaps: string[] };

/** The company industries of the client profile (keys) mapped to the starts of the consultant industry labels. */
const CLIENT_INDUSTRY_PREFIXES: Record<string, string[]> = {
  oil_gas: ['Oil & gas'],
  petrochemical: ['Petrochemicals', 'Chemicals'],
  banking: ['Banking', 'Capital markets', 'Payments', 'Leasing', 'Asset management'],
  telecom: ['Telecommunications'],
  healthcare: ['Healthcare', 'Life sciences', 'Medical devices'],
  retail: ['Retail', 'Wholesale', 'Consumer products'],
  manufacturing: ['Discrete manufacturing', 'Process manufacturing', 'Industrial machinery', 'Automotive', 'Aerospace', 'High tech', 'Building materials', 'Metals', 'Mill products'],
  government: ['Government', 'Municipalities', 'Defense'],
  education: ['Education', 'Higher education'],
  construction: ['Engineering, construction', 'Real estate', 'Building materials'],
  logistics: ['Logistics', 'Transportation', 'Postal'],
  utilities: ['Utilities', 'Renewable'],
  technology: ['IT services', 'High tech'],
};

const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const list = (v: string[] | null | undefined): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
const has = (values: string[], wanted: string): boolean => values.some((v) => norm(v) === norm(wanted));

/** 1 for the same industry, 0.6 for the same industry family, 0.5 when a client company key (oil_gas...) covers one of the labels. */
function industryFit(wanted: string, have: string[]): number {
  if (!wanted || have.length === 0) return 0;
  if (has(have, wanted)) return 1;
  const prefixes = CLIENT_INDUSTRY_PREFIXES[norm(wanted).replace(/[ &-]+/g, '_')];
  if (prefixes && have.some((h) => prefixes.some((p) => norm(h).startsWith(norm(p))))) return 0.9;
  const family = norm(familyOf(wanted));
  if (have.some((h) => norm(familyOf(h)) === family)) return 0.6;
  return 0;
}

/** 1 for the same segment, 0.5 for another segment of the same family (public / private / not-for-profit). */
function segmentFit(wanted: string, have: string[]): number {
  if (!wanted || have.length === 0) return 0;
  if (has(have, wanted)) return 1;
  const family = segmentFamily(wanted);
  if (family && have.some((h) => segmentFamily(h) === family)) return 0.5;
  return 0;
}

/** 1 when the consultant configured the localization of that country, 0.4 when able to work on site there, 0.25 for the same region. */
function countryFit(wanted: string, localized: string[], onsite: string[]): number {
  if (!wanted) return 0;
  if (has(localized, wanted)) return 1;
  if (has(onsite, wanted)) return 0.4;
  const region = regionOfCountry(wanted);
  if (region && localized.some((c) => regionOfCountry(c) === region)) return 0.25;
  return 0;
}

/** The share of the wanted items the consultant has (exact label). */
function shareFit(wanted: string[], have: string[]): number {
  if (wanted.length === 0 || have.length === 0) return 0;
  return wanted.filter((w) => has(have, w)).length / wanted.length;
}

const round = (n: number): number => Math.round(n);

export function contextFit(request: RequestContext, consultant: ConsultantContext): ContextFit {
  const industry = String(request.industry ?? '').trim();
  const segment = String(request.customer_segment ?? '').trim();
  const country = String(request.country ?? '').trim();
  const projectType = String(request.project_type ?? '').trim();
  const verticals = list(request.vertical_solutions).filter((v) => !isOther(v));
  const localizationSolutions = list(request.localization_solutions).filter((v) => !isOther(v));

  const parts: Array<{ key: keyof typeof CONTEXT_WEIGHTS; weight: number; fit: number; label: string; items?: string[]; have?: string[] }> = [];
  if (industry) parts.push({ key: 'industry', weight: CONTEXT_WEIGHTS.industry, fit: industryFit(industry, list(consultant.industries)), label: `Industry: ${industry}` });
  if (segment) parts.push({ key: 'customer_segment', weight: CONTEXT_WEIGHTS.customer_segment, fit: segmentFit(segment, list(consultant.customer_segments)), label: `Customer segment: ${segment}` });
  if (country) parts.push({ key: 'country', weight: CONTEXT_WEIGHTS.country, fit: countryFit(country, list(consultant.localization_countries), list(consultant.onsite_countries)), label: `Country: ${country}` });
  if (verticals.length > 0) parts.push({ key: 'vertical', weight: CONTEXT_WEIGHTS.vertical, fit: shareFit(verticals, list(consultant.vertical_solutions)), label: 'Vertical solution', items: verticals, have: list(consultant.vertical_solutions) });
  if (localizationSolutions.length > 0) parts.push({ key: 'localization_solution', weight: CONTEXT_WEIGHTS.localization_solution, fit: shareFit(localizationSolutions, list(consultant.localization_solutions)), label: 'Localization solution', items: localizationSolutions, have: list(consultant.localization_solutions) });
  if (projectType) parts.push({ key: 'project_type', weight: CONTEXT_WEIGHTS.project_type, fit: has(list(consultant.project_types), projectType) ? 1 : 0, label: `Project type: ${projectType}` });

  if (parts.length === 0) return { score: null, matches: [], gaps: [] };
  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  const got = parts.reduce((sum, p) => sum + p.weight * p.fit, 0);
  return {
    score: round((100 * got) / total),
    // one entry per requested item for the two list criteria, so that every label can be shown (and translated) on its own
    matches: parts.flatMap((p) => (p.items ? p.items.filter((i) => has(p.have ?? [], i)).map((i) => `${p.label}: ${i}`) : p.fit >= 0.5 ? [p.label] : [])),
    gaps: parts.flatMap((p) => (p.items ? p.items.filter((i) => !has(p.have ?? [], i)).map((i) => `${p.label}: ${i}`) : p.fit < 0.5 ? [p.label] : [])),
  };
}

/** Reads the request context from a ticket_context object (unknown keys and wrong types are ignored). */
export function readRequestContext(raw: unknown): RequestContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : null);
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 160)).filter(Boolean).slice(0, 12) : []);
  return {
    industry: str(o.industry),
    customer_segment: str(o.customer_segment),
    country: str(o.country),
    project_type: str(o.project_type),
    vertical_solutions: arr(o.vertical_solutions),
    localization_solutions: arr(o.localization_solutions),
  };
}


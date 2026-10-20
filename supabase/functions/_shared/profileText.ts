/**
 * Profile text matching: relates the words of a ticket to EVERY usable consultant profile field (not only the structured tags).
 *
 * - buildProfileEntries: the "profile search document" of one consultant, one entry per skill / certificate / project / job / education /
 *   review / solved request, plus bio and CV summary. Private fields are never read (contact links, bank data, nationality, phone, former
 *   employers' names) and fields an administrator set to "hidden" are skipped.
 * - extractTerms: lower-cased, accent- and Arabic-letter-normalised terms: SAP concepts (synonym pairs, English and Arabic, e.g.
 *   "S/4HANA" = "S4" = "اس فور هانا"), T-codes, message numbers, SAP Note numbers and plain words.
 * - matchProfile: distinct matched terms, weighted by where they matched (verified certificate / solved request > project > skill >
 *   work history > bio > education) and by how rare the term is among the candidates; repeated terms count once and keyword-stuffed
 *   profiles are scaled down. Only the TICKET's words are returned as "matched words", so no profile text is ever revealed.
 *
 * The same synonym list is seeded into the database (docs/sql/profile-search.sql) for the full-text index; a test keeps both in sync.
 */

export type DocKind = 'certificate_verified' | 'solved' | 'project' | 'skill' | 'certificate' | 'work_history' | 'bio' | 'review' | 'education';
export type ProfileEntry = { kind: DocKind; text: string };
/** Where a term matched, as shown to the client ("matched in: 2 projects, 1 certificate, skills"). */
export type MatchedIn = 'certificate' | 'solved' | 'project' | 'skill' | 'work_history' | 'bio' | 'review' | 'education';

/** How much a match counts by where it was found (verified evidence highest). */
export const KIND_WEIGHT: Record<DocKind, number> = {
  certificate_verified: 1, solved: 0.95, project: 0.8, skill: 0.7, certificate: 0.65, work_history: 0.5, bio: 0.35, review: 0.3, education: 0.2,
};
/** Full-text weight class per kind in the database document (A = skills/modules/certificates/projects ... D = education). */
export const KIND_CLASS: Record<DocKind, 'A' | 'B' | 'C' | 'D'> = {
  certificate_verified: 'A', solved: 'A', project: 'A', skill: 'A', certificate: 'A', work_history: 'B', bio: 'C', review: 'D', education: 'D',
};
const IN_OF: Record<DocKind, MatchedIn> = {
  certificate_verified: 'certificate', certificate: 'certificate', solved: 'solved', project: 'project', skill: 'skill',
  work_history: 'work_history', bio: 'bio', review: 'review', education: 'education',
};

// ---------------------------------------------------------------- normalisation

/** Lower case, no Latin accents, no Arabic diacritics or tatweel, one form of alef / yaa / taa marbuta (same rules as the SQL side). */
export function normalizeText(input: string | null | undefined): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .toLowerCase();
}

// ---------------------------------------------------------------- SAP synonyms (English and Arabic pairs)

export type Concept = { key: string; label: string; variants: string[] };

export const SAP_CONCEPTS: Concept[] = [
  { key: 'fi', label: 'SAP FI', variants: ['fi', 'fico', 'fi/co', 'fi-co', 'finance', 'financial accounting', 'financials', 'مالية', 'محاسبة مالية', 'النظام المالي'] },
  { key: 'co', label: 'SAP CO', variants: ['co', 'controlling', 'cost accounting', 'cost center', 'cost centre', 'محاسبة التكاليف', 'مراكز التكلفة'] },
  { key: 'mm', label: 'SAP MM', variants: ['mm', 'materials management', 'material management', 'purchasing', 'procurement', 'مشتريات', 'ادارة المواد'] },
  { key: 'sd', label: 'SAP SD', variants: ['sd', 'sales and distribution', 'sales order', 'sales orders', 'مبيعات', 'اوامر البيع', 'امر بيع'] },
  { key: 'pp', label: 'SAP PP', variants: ['pp', 'production planning', 'manufacturing', 'mrp', 'تخطيط الانتاج', 'تصنيع'] },
  { key: 'hcm', label: 'SAP HCM', variants: ['hcm', 'hr', 'human resources', 'personnel administration', 'موارد البشرية', 'شؤون الموظفين'] },
  { key: 'payroll', label: 'Payroll', variants: ['payroll', 'رواتب', 'مسير الرواتب'] },
  { key: 'sf', label: 'SuccessFactors', variants: ['successfactors', 'success factors', 'sfsf', 'sf', 'سكسس فاكتورز', 'سكسيس فاكتورز', 'سكسس فاكتور'] },
  { key: 'ec', label: 'Employee Central', variants: ['employee central', 'موظف المركزي'] },
  { key: 'abap', label: 'ABAP', variants: ['abap', 'abap cloud', 'abap oo', 'rap', 'restful abap', 'abap restful', 'restful application programming', 'اباب'] },
  { key: 'fiori', label: 'Fiori / UI5', variants: ['fiori', 'ui5', 'sapui5', 'openui5', 'fiori elements', 'fiori launchpad', 'فيوري'] },
  { key: 'basis', label: 'Basis', variants: ['basis', 'netweaver', 'بيسيس', 'بيسس'] },
  { key: 'hana', label: 'HANA', variants: ['hana', 'hana db', 'hana database', 'هانا'] },
  { key: 'btp', label: 'SAP BTP', variants: ['btp', 'business technology platform', 'sap cloud platform', 'scp', 'منصة التقنية'] },
  { key: 'cpi', label: 'Integration Suite', variants: ['cpi', 'integration suite', 'cloud integration', 'pi/po', 'pipo', 'process orchestration', 'hci', 'تكامل', 'ربط الانظمة'] },
  { key: 's4', label: 'S/4HANA', variants: ['s/4hana', 's/4 hana', 's4hana', 's4 hana', 's/4hana cloud', 's/4', 's4', 'اس فور هانا', 'اس 4 هانا', 'اس4 هانا', 'اس/4 هانا', 'اس 4', 'اس4'] },
  { key: 'ecc', label: 'ECC', variants: ['ecc', 'ecc6', 'ecc 6.0', 'r/3', 'erp 6.0'] },
  { key: 'migration', label: 'Migration', variants: ['migration', 'migrations', 'migrate', 'migrated', 'migrating', 'system conversion', 'brownfield', 'greenfield', 'data migration', 'انتقال', 'نقل البيانات', 'ترحيل البيانات', 'تحويل النظام'] },
  { key: 'upgrade', label: 'Upgrade', variants: ['upgrade', 'upgrades', 'upgrading', 'ترقية'] },
  { key: 'closing', label: 'Month-end close', variants: ['month-end close', 'month end close', 'month-end', 'month end', 'period-end', 'period end', 'year-end', 'year end', 'financial closing', 'financial close', 'closing', 'اقفال'] },
  { key: 'vat', label: 'VAT', variants: ['vat', 'value added tax', 'value-added tax', 'ضريبة القيمة المضافة', 'القيمة المضافة'] },
  { key: 'einvoice', label: 'E-invoicing', variants: ['e-invoicing', 'e-invoice', 'einvoicing', 'electronic invoicing', 'zatca', 'fatoora', 'فوترة الكترونية', 'فاتورة الكترونية', 'هيئة الزكاة'] },
  { key: 'posting', label: 'Posting', variants: ['posting', 'postings', 'journal entry', 'journal entries', 'ترحيل', 'قيد يومية'] },
  { key: 'gl', label: 'General ledger', variants: ['general ledger', 'g/l', 'gl', 'الاستاذ العام', 'دفتر الاستاذ'] },
  { key: 'payable', label: 'Accounts payable', variants: ['accounts payable', 'account payable', 'vendor invoice', 'vendor invoices', 'الذمم الدائنة'] },
  { key: 'receivable', label: 'Accounts receivable', variants: ['accounts receivable', 'account receivable', 'الذمم المدينة'] },
  { key: 'assets', label: 'Asset accounting', variants: ['asset accounting', 'fixed assets', 'fixed asset', 'الاصول الثابتة'] },
  { key: 'po', label: 'Purchase order', variants: ['purchase order', 'purchase orders', 'po', 'امر شراء', 'اوامر الشراء', 'امر الشراء'] },
  { key: 'pricing', label: 'Pricing', variants: ['pricing', 'condition records', 'condition record', 'تسعير'] },
  { key: 'inventory', label: 'Inventory', variants: ['inventory', 'stock', 'goods receipt', 'goods issue', 'مخزون'] },
  { key: 'idoc', label: 'IDoc', variants: ['idoc', 'idocs'] },
  { key: 'infra', label: 'Infrastructure', variants: ['vmware', 'vsphere', 'esxi', 'infrastructure', 'بنية التحتية'] },
  { key: 'security', label: 'Authorizations', variants: ['authorization', 'authorizations', 'authorisation', 'authorisations', 'grc', 'صلاحيات'] },
  { key: 'ariba', label: 'Ariba', variants: ['ariba', 'اريبا'] },
  { key: 'bw', label: 'BW', variants: ['bw', 'bw/4hana', 'business warehouse', 'datasphere'] },
  { key: 'saudi', label: 'Saudi Arabia', variants: ['saudi', 'saudi arabia', 'ksa', 'riyadh', 'jeddah', 'dammam', 'المملكة العربية السعودية', 'سعودية', 'سعودي', 'رياض', 'جدة'] },
  { key: 'egypt', label: 'Egypt', variants: ['egypt', 'egyptian', 'cairo', 'مصر', 'قاهرة'] },
  { key: 'uae', label: 'UAE', variants: ['uae', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi', 'امارات', 'دبي', 'ابوظبي', 'ابو ظبي'] },
];

/** (normalised variant, concept key) rows, the exact list seeded into `public.sap_term_synonyms`. */
export const SYNONYM_ROWS: Array<[string, string]> = (() => {
  const seen = new Map<string, string>();
  for (const c of SAP_CONCEPTS) for (const v of c.variants) { const n = normalizeText(v).trim(); if (n && !seen.has(n)) seen.set(n, c.key); }
  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
})();

const LABEL_OF = new Map(SAP_CONCEPTS.map((c) => [c.key, c.label]));
const isArabic = (s: string) => /[\u0600-\u06FF]/.test(s);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const EDGE = 'a-z0-9\\u0600-\\u06FF';
// Arabic words may carry a joined conjunction / preposition and the article ("والمشتريات", "للرواتب", "بالسعودية").
const AR_PREFIX = '(?:لل|(?:و|ف|ب|ل|ك)?(?:ال)?)';
const COMPILED: Array<{ key: string; re: RegExp }> = SYNONYM_ROWS.map(([variant, key]) => ({
  key,
  re: new RegExp(`(?<![${EDGE}])${isArabic(variant) ? AR_PREFIX : ''}${esc(variant)}(?![${EDGE}])`, 'g'),
}));

// ---------------------------------------------------------------- terms

const STOP_EN = new Set(('a about after again all also am an and any are as at be been before being both but by can cannot could did do does doing done '
  + 'during each for from further get gets got had has have having he her here his how i if in into is it its just me more most my need needs no not now of '
  + 'on once only or other our out over own please same she should since so some such than that the their them then there these they this those through to '
  + 'too under until up us use used using very was we were what when where which while who why will with would you your sap error errors issue issues '
  + 'problem problems system systems help working work works fail fails failed failing failure show shows showing new one two also cannot after want able '
  + 'getting doesnt dont isnt still every any client company team support urgent asap thanks hello hi experience experienced consultant years year').split(' '));
const STOP_AR = new Set(['في', 'من', 'علي', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك', 'عند', 'بعد', 'قبل', 'لا', 'ما', 'تم', 'ثم', 'او', 'ان', 'انه', 'كل',
  'قد', 'لقد', 'كان', 'كانت', 'يكون', 'نحتاج', 'نريد', 'مشكله', 'مشاكل', 'نظام', 'النظام', 'خطا', 'رساله', 'يوجد', 'توجد', 'عندنا', 'لدينا', 'لدي', 'هناك',
  'التي', 'الذي', 'وهو', 'وهي', 'هو', 'هي', 'نحن', 'انا', 'شركه', 'الشركه', 'يعمل', 'لايعمل', 'يظهر', 'تظهر', 'حيث', 'منذ', 'حتي', 'بين', 'غير', 'جدا', 'مستشار']);

const stemWord = (w: string): string => {
  if (isArabic(w)) {
    let x = w;
    for (const p of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']) if (x.startsWith(p) && x.length - p.length >= 3) { x = x.slice(p.length); break; }
    if (x.endsWith('ات') && x.length - 2 >= 3) x = x.slice(0, -2);
    return x;
  }
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};

const CODE = /^(?:[a-z]{1,5}\d{1,4}[a-z]?|[a-z]+_[a-z0-9_]+|\d{5,8})$/;
const MESSAGE = /(?:message|error|msg|رساله|خطا)[^a-z0-9\n]{0,12}(?:no\.?\s*)?([a-z][a-z0-9]{1,3}|\d{2})\s?(\d{3})(?![0-9])/g;
const SPLIT_MESSAGE = /(?<![a-z0-9])([a-z]\d|\d[a-z])\s(\d{3})(?![0-9])/g;
const TOKEN = /[a-z0-9_]+|[\u0621-\u064A]+/g;

export type Term = { id: string; label: string; weight: number };
export type TermBag = { terms: Map<string, Term>; tokens: number; repeats: number };

/** Terms of a text: concepts (weight 2), codes (T-codes, message and note numbers; weight 3) and plain words (weight 1). */
export function extractTerms(text: string | null | undefined): TermBag {
  let s = ` ${normalizeText(text)} `;
  const terms = new Map<string, Term>();
  const add = (id: string, label: string, weight: number) => { if (!terms.has(id)) terms.set(id, { id, label, weight }); };
  let tokens = 0;
  let repeats = 0;
  const seen = new Set<string>();
  const count = (id: string) => { tokens += 1; if (seen.has(id)) repeats += 1; else seen.add(id); };
  for (const re of [MESSAGE, SPLIT_MESSAGE]) {
    s = s.replace(re, (all, cls: string, num: string) => { const id = `k:${cls}${num}`; add(id, `${cls.toUpperCase()} ${num}`, 3); count(id); return all.slice(0, all.length - (cls.length + num.length + (all.endsWith(` ${num}`) && all.includes(`${cls} `) ? 1 : 0))) + ' '; });
  }
  for (const { key, re } of COMPILED) {
    s = s.replace(re, () => { const id = `c:${key}`; add(id, LABEL_OF.get(key) ?? key, 2); count(id); return ' '; });
  }
  for (const raw of s.match(TOKEN) ?? []) {
    if (CODE.test(raw) && /\d|_/.test(raw)) { const id = `k:${raw}`; add(id, raw.toUpperCase(), 3); count(id); continue; }
    if (/^\d+$/.test(raw) || raw.length < 3 || STOP_EN.has(raw) || STOP_AR.has(raw)) continue;
    const stem = stemWord(raw);
    if (stem.length < 3 || STOP_AR.has(stem)) continue;
    const id = `w:${stem}`;
    add(id, raw, 1);
    count(id);
  }
  return { terms, tokens, repeats };
}

/** The ticket's terms (concepts and codes first, then words), at most 40. */
export function ticketTerms(t: { title?: string | null; description?: string | null; area_details?: string | null; sap_modules?: string[] | null; sap_module?: string | null; sap_module_other?: string | null; sap_notes_tried?: string[] | null }): Term[] {
  const text = [t.title, t.description, t.area_details, ...(t.sap_modules ?? []), t.sap_module, t.sap_module_other].filter(Boolean).join('\n');
  const all = [...extractTerms(text).terms.values()];
  for (const n of t.sap_notes_tried ?? []) { const d = String(n).replace(/\D/g, ''); if (d.length >= 5 && d.length <= 8 && !all.some((x) => x.id === `k:${d}`)) all.push({ id: `k:${d}`, label: d, weight: 3 }); }
  return all.sort((a, b) => b.weight - a.weight).slice(0, 40);
}

// ---------------------------------------------------------------- profile document

export type ProfileSource = {
  bio?: string | null;
  seniority_level?: string | null;
  sap_technologies?: string[] | null;
  sap_roles?: string[] | null;
  industries?: string[] | null;
  customer_segments?: string[] | null;
  localization_countries?: string[] | null;
  localization_solutions?: string[] | null;
  vertical_solutions?: string[] | null;
  deployment_experience?: string[] | null;
  project_types?: string[] | null;
  work_modes?: string[] | null;
  skills?: Array<{ module?: string | null; certified?: boolean | null }> | null;
  certifications?: Array<{ name?: string | null; issuer?: string | null; verified?: boolean | null; expired?: boolean | null }> | null;
  projects?: Array<{ project_name?: string | null; role?: string | null; client_industry?: string | null; sap_modules?: string[] | null; description?: string | null }> | null;
  work_history?: Array<{ job_title?: string | null; description?: string | null }> | null;
  education?: Array<{ degree?: string | null; field_of_study?: string | null }> | null;
  cv?: { matching_summary?: string | null; expertise_keywords?: string[] | null } | null;
  /** Positive client ratings only (score 4-5); the comment is reduced to terms and never shown. */
  reviews?: Array<{ comment?: string | null; score?: number | null }> | null;
  /** Areas of requests this consultant resolved on the platform. */
  solved?: Array<{ sap_modules?: string[] | null; sap_module?: string | null }> | null;
};

/** Removes e-mail addresses, links and phone numbers (the edge function passes its stricter scrubber). */
export const basicScrub = (s: string): string => s
  .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, ' ')
  .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
  .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ');

/**
 * One consultant's profile search document. `hidden` holds the profile field keys an administrator set to "hidden"
 * (profile_field_rules); those fields are skipped. Contact links, bank data, nationality and employers' names are never inputs.
 */
export function buildProfileEntries(src: ProfileSource, hidden: ReadonlySet<string> = new Set(), scrub: (s: string) => string = basicScrub): ProfileEntry[] {
  const out: ProfileEntry[] = [];
  const seen = new Set<string>();
  const push = (kind: DocKind, ...parts: Array<string | null | undefined | false>) => {
    const text = scrub(parts.filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 4000);
    const key = `${kind}|${normalizeText(text)}`;
    if (text && !seen.has(key)) { seen.add(key); out.push({ kind, text }); }
  };
  const on = (field: string) => !hidden.has(field);
  const list = (field: string, v?: string[] | null) => (on(field) ? (v ?? []).join(', ') : '');

  if (on('skills')) for (const s of src.skills ?? []) push('skill', s.module);
  push('skill', list('sap_technologies', src.sap_technologies), list('sap_roles', src.sap_roles));
  if (on('certifications')) for (const c of src.certifications ?? []) if (!c.expired) push(c.verified ? 'certificate_verified' : 'certificate', c.name, c.issuer);
  if (on('projects')) for (const p of src.projects ?? []) push('project', p.project_name, p.role, p.client_industry, (p.sap_modules ?? []).join(', '), p.description);
  for (const t of src.solved ?? []) push('solved', [...(t.sap_modules ?? []), t.sap_module].filter(Boolean).join(', '));
  if (on('work_history')) for (const w of src.work_history ?? []) push('work_history', w.job_title, w.description);
  push('work_history', list('industries', src.industries), list('customer_segments', src.customer_segments), list('localization_countries', src.localization_countries),
    list('localization_solutions', src.localization_solutions), list('vertical_solutions', src.vertical_solutions), list('deployment_experience', src.deployment_experience),
    list('project_types', src.project_types));
  if (on('bio')) push('bio', src.bio);
  if (on('seniority_level')) push('bio', src.seniority_level);
  if (on('cv') && src.cv) push('bio', src.cv.matching_summary, (src.cv.expertise_keywords ?? []).join(', '));
  if (on('education')) for (const e of src.education ?? []) push('education', e.degree, e.field_of_study);
  for (const r of src.reviews ?? []) if ((r.score ?? 0) >= 4) push('review', r.comment);
  return out;
}

export type ProfileIndex = {
  entries: Array<{ kind: DocKind; terms: Set<string>; cap: number }>;
  byTerm: Map<string, number[]>;
  wordsByPrefix: Map<string, string[]>;
  /** 1 for a normal profile; down to 0.5 when the same terms are repeated over and over (keyword stuffing). */
  stuffing: number;
};

export function indexProfile(entries: ProfileEntry[] | null | undefined): ProfileIndex {
  const out: ProfileIndex = { entries: [], byTerm: new Map(), wordsByPrefix: new Map(), stuffing: 1 };
  let tokens = 0;
  let repeats = 0;
  for (const e of entries ?? []) {
    const bag = extractTerms(e.text);
    tokens += bag.tokens;
    repeats += bag.repeats;
    if (bag.terms.size === 0) continue;
    const i = out.entries.length;
    // A very long list of distinct terms in one entry counts less per term.
    out.entries.push({ kind: e.kind, terms: new Set(bag.terms.keys()), cap: Math.min(1, Math.sqrt(60 / bag.terms.size)) });
    for (const id of bag.terms.keys()) {
      const at = out.byTerm.get(id);
      if (at) { if (!at.includes(i)) at.push(i); } else out.byTerm.set(id, [i]);
    }
  }
  for (const id of out.byTerm.keys()) {
    if (!id.startsWith('w:') || id.length < 7) continue;
    const p = id.slice(2, 4);
    const list = out.wordsByPrefix.get(p);
    if (list) list.push(id); else out.wordsByPrefix.set(p, [id]);
  }
  if (tokens >= 30) out.stuffing = Math.max(0.5, Math.min(1, (1 - repeats / tokens) / 0.5));
  return out;
}

/** pg_trgm-style trigram similarity of two words (0..1). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (w: string) => { const s = `  ${w} `; const g = new Set<string>(); for (let i = 0; i + 3 <= s.length; i++) g.add(s.slice(i, i + 3)); return g; };
  const A = grams(a); const B = grams(b);
  let both = 0;
  for (const g of A) if (B.has(g)) both += 1;
  return both / (A.size + B.size - both || 1);
}

export type TextPrep = { terms: Term[]; idf: Map<string, number> };

/** Rarer terms count more: inverse document frequency over the candidate consultants. */
export function prepareTextMatch(terms: Term[], indexes: ProfileIndex[]): TextPrep {
  const n = Math.max(1, indexes.length);
  const idf = new Map<string, number>();
  for (const t of terms) {
    const df = indexes.reduce((sum, x) => sum + (x.byTerm.has(t.id) ? 1 : 0), 0);
    idf.set(t.id, Math.log(1 + n / (1 + df)));
  }
  return { terms, idf };
}

export type TextMatch = {
  /** 0..1 */
  fit: number;
  /** The ticket's words that matched, best first (max 6). */
  terms: string[];
  /** Number of matched entries per place ("2 projects, 1 certificate, skills"). */
  in: Partial<Record<MatchedIn, number>>;
};

/** Matches the ticket's terms against one profile. `rank` and `trigram` are the database full-text signals when available (0..1). */
export function matchProfile(prep: TextPrep, index: ProfileIndex, db?: { rank?: number | null; trigram?: number | null } | null): TextMatch {
  let total = 0;
  let matched = 0;
  const hits: Array<{ label: string; score: number }> = [];
  const entriesHit = new Set<number>();
  for (const t of prep.terms) {
    const w = t.weight * (prep.idf.get(t.id) ?? 1);
    total += w;
    let at = index.byTerm.get(t.id) ?? [];
    let factor = 1;
    if (at.length === 0 && t.id.startsWith('w:') && t.id.length >= 7) {
      // Fuzzy: "migrations" ~ "migration", "reconcilation" ~ "reconciliation" (half credit).
      const best = (index.wordsByPrefix.get(t.id.slice(2, 4)) ?? []).map((id) => ({ id, s: trigramSimilarity(t.id.slice(2), id.slice(2)) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.6) { at = index.byTerm.get(best.id) ?? []; factor = 0.5; }
    }
    if (at.length === 0) continue;
    const kindWeight = Math.max(...at.map((i) => KIND_WEIGHT[index.entries[i].kind] * index.entries[i].cap));
    const score = w * kindWeight * factor;
    matched += score;
    hits.push({ label: t.label, score });
    at.forEach((i) => entriesHit.add(i));
  }
  const ratio = total > 0 ? (matched * index.stuffing) / total : 0;
  let fit = Math.min(1, ratio / 0.55);
  if (db && (db.rank != null || db.trigram != null)) fit = 0.75 * fit + 0.15 * Math.max(0, Math.min(1, db.rank ?? 0)) + 0.1 * Math.max(0, Math.min(1, db.trigram ?? 0));
  const inCounts: Partial<Record<MatchedIn, number>> = {};
  for (const i of entriesHit) { const k = IN_OF[index.entries[i].kind]; inCounts[k] = (inCounts[k] ?? 0) + 1; }
  const labels: string[] = [];
  for (const h of hits.sort((a, b) => b.score - a.score)) if (!labels.some((l) => l.toLowerCase() === h.label.toLowerCase())) labels.push(h.label);
  return { fit: Math.round(fit * 1000) / 1000, terms: labels.slice(0, 6), in: inCounts };
}

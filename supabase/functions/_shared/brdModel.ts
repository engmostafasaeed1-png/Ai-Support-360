// Business Requirements Document (BRD) from a ticket: the document model shared by the browser editor, the PDF/Word
// exports, the ticket-brd function and the tests. Pure functions only (no Deno or browser APIs).
//
// Rules kept here so every surface agrees:
// - one fixed catalogue of 16 sections (document control is the header block, the change log is always last and is
//   generated from the version notes, never typed);
// - templates only decide which sections start visible; every section can be shown, hidden and reordered;
// - requirement ids are REQ-001, REQ-002 ... in table order;
// - version numbers are max + 1 (the database assigns them under a row lock; this mirror is for display and tests);
// - stored section text is a small allowlisted HTML subset (see ALLOWED_TAGS); "To be confirmed" gaps are
//   <mark data-tbc="1">...</mark>.

export type BrdLanguage = 'en' | 'ar' | 'both';
export type BrdTemplate = 'standard' | 'short' | 'technical' | 'incident';
export type ReqPriority = 'must' | 'should' | 'could';
export type ReqStatus = 'proposed' | 'agreed' | 'in_progress' | 'done' | 'rejected';
export type BrdStatus = 'draft' | 'final';

export const BRD_LANGUAGES: readonly BrdLanguage[] = ['en', 'ar', 'both'];
export const BRD_TEMPLATES: readonly BrdTemplate[] = ['standard', 'short', 'technical', 'incident'];
export const REQ_PRIORITIES: readonly ReqPriority[] = ['must', 'should', 'could'];
export const REQ_STATUSES: readonly ReqStatus[] = ['proposed', 'agreed', 'in_progress', 'done', 'rejected'];

export const SECTION_KEYS = [
  'purpose', 'objectives', 'scope', 'current_future', 'stakeholders', 'functional', 'non_functional', 'sap_landscape',
  'data_migration', 'assumptions', 'risks', 'testing', 'timeline', 'open_questions', 'attachments', 'change_log',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** Sections the AI may write (the change log is generated). */
export const AI_SECTION_KEYS = SECTION_KEYS.filter((k) => k !== 'change_log') as Exclude<SectionKey, 'change_log'>[];

export const SECTION_TITLES: Record<SectionKey, { en: string; ar: string }> = {
  purpose: { en: 'Purpose and background', ar: 'الغرض والخلفية' },
  objectives: { en: 'Business objectives and success criteria', ar: 'أهداف العمل ومعايير النجاح' },
  scope: { en: 'Scope (in scope / out of scope)', ar: 'النطاق (داخل النطاق / خارج النطاق)' },
  current_future: { en: 'Current situation (AS-IS) and desired situation (TO-BE)', ar: 'الوضع الحالي (AS-IS) والوضع المطلوب (TO-BE)' },
  stakeholders: { en: 'Stakeholders and roles', ar: 'أصحاب المصلحة والأدوار' },
  functional: { en: 'Functional requirements', ar: 'المتطلبات الوظيفية' },
  non_functional: { en: 'Non-functional requirements', ar: 'المتطلبات غير الوظيفية' },
  sap_landscape: { en: 'SAP landscape and technical context', ar: 'بيئة SAP والسياق التقني' },
  data_migration: { en: 'Data and migration needs', ar: 'احتياجات البيانات والترحيل' },
  assumptions: { en: 'Assumptions, constraints and dependencies', ar: 'الافتراضات والقيود والاعتماديات' },
  risks: { en: 'Risks and mitigations', ar: 'المخاطر وإجراءات التخفيف' },
  testing: { en: 'Testing and acceptance approach (UAT)', ar: 'منهجية الاختبار والقبول (UAT)' },
  timeline: { en: 'Timeline and urgency', ar: 'الجدول الزمني ودرجة الاستعجال' },
  open_questions: { en: 'Open questions', ar: 'الأسئلة المفتوحة' },
  attachments: { en: 'Attachments and references', ar: 'المرفقات والمراجع' },
  change_log: { en: 'Change log', ar: 'سجل التغييرات' },
};

export const TEMPLATE_TITLES: Record<BrdTemplate, { en: string; ar: string }> = {
  standard: { en: 'Standard BRD', ar: 'وثيقة متطلبات قياسية' },
  short: { en: 'Short one-page', ar: 'صفحة واحدة مختصرة' },
  technical: { en: 'Technical change request', ar: 'طلب تغيير تقني' },
  incident: { en: 'Incident / problem report', ar: 'تقرير حادثة / مشكلة' },
};

/** Sections that start visible for each template (the rest exist but are hidden). */
export const TEMPLATE_SECTIONS: Record<BrdTemplate, readonly SectionKey[]> = {
  standard: SECTION_KEYS,
  short: ['purpose', 'objectives', 'scope', 'functional', 'timeline', 'open_questions', 'change_log'],
  technical: ['purpose', 'current_future', 'functional', 'non_functional', 'sap_landscape', 'data_migration', 'risks', 'testing', 'timeline', 'open_questions', 'attachments', 'change_log'],
  incident: ['purpose', 'current_future', 'sap_landscape', 'risks', 'testing', 'timeline', 'open_questions', 'attachments', 'change_log'],
};

export const LIMITS = {
  sectionChars: 20_000,
  requirements: 150,
  questions: 8,
  questionOptions: 4,
  title: 200,
  note: 500,
  reqText: 2_000,
  owner: 120,
  approvers: 500,
  contentBytes: 400_000,
  commentChars: 4_000,
} as const;

export interface BrdSection { key: SectionKey; html: string; html_ar?: string; hidden?: boolean }
export interface BrdRequirement {
  id: string;
  description: string;
  description_ar?: string;
  priority: ReqPriority;
  status: ReqStatus;
  owner: string;
  acceptance: string;
  acceptance_ar?: string;
}
export interface BrdQuestion { id: string; question: string; options: string[]; answer: string }
export interface BrdControl {
  title: string;
  ticket_ref: string;
  company: string;
  requester: string;
  date: string;
  status: BrdStatus;
  approvers: string;
}
export interface BrdContent {
  schema: 1;
  language: BrdLanguage;
  template: BrdTemplate;
  control: BrdControl;
  sections: BrdSection[];
  requirements: BrdRequirement[];
  questions: BrdQuestion[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list as readonly string[]).includes(v as string) ? (v as T) : fallback;

/** Short, readable ticket reference used in the document control block, page headers and file names. */
export function ticketRef(ticketId: string): string {
  return String(ticketId || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'TICKET';
}

export function requirementId(n: number): string {
  return `REQ-${String(Math.max(1, Math.floor(n))).padStart(3, '0')}`;
}

/** REQ-001 ... in table order (after add / remove / drag). */
export function renumberRequirements(list: readonly BrdRequirement[]): BrdRequirement[] {
  return list.map((r, i) => ({ ...r, id: requirementId(i + 1) }));
}

export function emptyRequirement(n: number): BrdRequirement {
  return { id: requirementId(n), description: '', priority: 'should', status: 'proposed', owner: '', acceptance: '' };
}

/** Mirror of the database rule: the next version is the highest existing number + 1 (archived versions still count). */
export function nextVersionNumber(existing: readonly number[]): number {
  const valid = existing.filter((n) => Number.isInteger(n) && n > 0);
  return (valid.length ? Math.max(...valid) : 0) + 1;
}

export function emptyContent(opts: {
  language?: BrdLanguage; template?: BrdTemplate; title?: string; ticketRef?: string; company?: string; requester?: string; date?: string;
} = {}): BrdContent {
  const template = opts.template ?? 'standard';
  const visible = new Set(TEMPLATE_SECTIONS[template]);
  return {
    schema: 1,
    language: opts.language ?? 'en',
    template,
    control: {
      title: str(opts.title, LIMITS.title),
      ticket_ref: str(opts.ticketRef, 40),
      company: str(opts.company, 200),
      requester: str(opts.requester, 200),
      date: (opts.date ?? new Date().toISOString()).slice(0, 10),
      status: 'draft',
      approvers: '',
    },
    sections: SECTION_KEYS.map((key) => ({ key, html: '', ...(opts.language === 'both' ? { html_ar: '' } : {}), hidden: !visible.has(key) })),
    requirements: [],
    questions: [],
  };
}

/**
 * Defensive read of stored or received content: every section exactly once (unknown keys dropped, missing ones
 * appended hidden), the change log last, limits applied, requirement ids renumbered.
 */
export function normalizeContent(raw: unknown): BrdContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const language = pick(r.language, BRD_LANGUAGES, 'en');
  const template = pick(r.template, BRD_TEMPLATES, 'standard');
  const c = (r.control && typeof r.control === 'object' ? r.control : {}) as Record<string, unknown>;
  const seen = new Set<SectionKey>();
  const sections: BrdSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const key = o.key as SectionKey;
    if (!(SECTION_KEYS as readonly string[]).includes(key) || seen.has(key) || key === 'change_log') continue;
    seen.add(key);
    sections.push({
      key,
      html: str(o.html, LIMITS.sectionChars * 2),
      ...(language === 'both' ? { html_ar: str(o.html_ar, LIMITS.sectionChars * 2) } : {}),
      hidden: o.hidden === true,
    });
  }
  const visible = new Set(TEMPLATE_SECTIONS[template]);
  for (const key of SECTION_KEYS) {
    if (key === 'change_log' || seen.has(key)) continue;
    sections.push({ key, html: '', ...(language === 'both' ? { html_ar: '' } : {}), hidden: !visible.has(key) });
  }
  const changeLog = (Array.isArray(r.sections) ? r.sections : []).find((s) => (s as { key?: string })?.key === 'change_log') as { hidden?: boolean } | undefined;
  sections.push({ key: 'change_log', html: '', hidden: changeLog ? changeLog.hidden === true : false });

  const requirements = renumberRequirements(
    (Array.isArray(r.requirements) ? r.requirements : []).slice(0, LIMITS.requirements).map((q) => {
      const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
      return {
        id: '',
        description: str(o.description, LIMITS.reqText),
        ...(language === 'both' ? { description_ar: str(o.description_ar, LIMITS.reqText) } : {}),
        priority: pick(o.priority, REQ_PRIORITIES, 'should'),
        status: pick(o.status, REQ_STATUSES, 'proposed'),
        owner: str(o.owner, LIMITS.owner),
        acceptance: str(o.acceptance, LIMITS.reqText),
        ...(language === 'both' ? { acceptance_ar: str(o.acceptance_ar, LIMITS.reqText) } : {}),
      };
    }),
  );
  const questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, LIMITS.questions).map((q, i) => {
    const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
    return {
      id: str(o.id, 20) || `Q${i + 1}`,
      question: str(o.question, 300),
      options: (Array.isArray(o.options) ? o.options : []).slice(0, LIMITS.questionOptions).map((x) => str(x, 120)).filter(Boolean),
      answer: str(o.answer, 1000),
    };
  }).filter((q) => q.question.trim());
  return {
    schema: 1,
    language,
    template,
    control: {
      title: str(c.title, LIMITS.title),
      ticket_ref: str(c.ticket_ref, 40),
      company: str(c.company, 200),
      requester: str(c.requester, 200),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(c.date ?? '')) ? String(c.date) : new Date().toISOString().slice(0, 10),
      status: c.status === 'final' ? 'final' : 'draft',
      approvers: str(c.approvers, LIMITS.approvers),
    },
    sections,
    requirements,
    questions,
  };
}

/** Visible sections in document order with their printed number (1, 2, ...). */
export function visibleSections(content: BrdContent): Array<BrdSection & { number: number }> {
  let n = 0;
  return content.sections.filter((s) => !s.hidden).map((s) => ({ ...s, number: ++n }));
}

export function sectionTitle(key: SectionKey, lang: 'en' | 'ar'): string {
  return SECTION_TITLES[key][lang];
}

/** BRD_<ticketRef>_v<N>_<YYYY-MM-DD>.pdf */
export function brdFileName(ref: string, version: number, date: Date | string = new Date(), ext = 'pdf'): string {
  const d = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const safeRef = String(ref || 'TICKET').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20) || 'TICKET';
  return `BRD_${safeRef}_v${Math.max(1, Math.floor(version))}_${d}.${ext}`;
}

// ---------------------------------------------------------------- text helpers

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
    if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

/** Plain text of the stored HTML (block ends become new lines). */
export function htmlToText(html: string): string {
  return decodeEntities(
    String(html ?? '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<[^>]*>/g, ''),
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function textLength(html: string): number {
  return htmlToText(html).length;
}

/** Number of "To be confirmed" gaps left in a section. */
export function countTbc(html: string): number {
  return (String(html ?? '').match(/<mark\b[^>]*data-tbc/gi) ?? []).length;
}

export const TBC_LABEL = { en: 'To be confirmed', ar: 'يُؤكَّد لاحقاً' } as const;

/** Converts the model's [[TBC: ...]] tokens into highlighted placeholders (text is escaped first). */
export function tbcToHtml(escaped: string, lang: 'en' | 'ar'): string {
  return escaped.replace(/\[\[\s*TBC\s*:?\s*([^\]]{0,200})\]\]/gi, (_m, what: string) =>
    `<mark data-tbc="1">${TBC_LABEL[lang]}${what.trim() ? `: ${what.trim()}` : ''}</mark>`);
}

export type Block = { type: 'p' | 'ul' | 'ol' | 'h'; text?: string | null; items?: string[] | null };

/** The model returns plain-text blocks; they are escaped here, so model output can never inject markup. */
export function blocksToHtml(blocks: readonly Block[] | null | undefined, lang: 'en' | 'ar'): string {
  const out: string[] = [];
  for (const b of blocks ?? []) {
    if (!b || typeof b !== 'object') continue;
    const line = (s: string) => tbcToHtml(escapeHtml(String(s ?? '').slice(0, 4000)), lang).replace(/\n/g, '<br>');
    if (b.type === 'ul' || b.type === 'ol') {
      const items = (b.items ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 40);
      if (items.length) out.push(`<${b.type}>${items.map((x) => `<li>${line(x)}</li>`).join('')}</${b.type}>`);
    } else if (b.type === 'h') {
      if (b.text?.trim()) out.push(`<h4>${line(b.text.trim())}</h4>`);
    } else if (b.text?.trim()) {
      out.push(`<p>${line(b.text.trim())}</p>`);
    }
  }
  return out.join('');
}

export function contentBytes(content: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(content)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Problems that block saving (shown before the server refuses the same thing). */
export function contentProblems(content: BrdContent): string[] {
  const out: string[] = [];
  if (!content.control.title.trim()) out.push('title');
  for (const s of content.sections) {
    if (textLength(s.html) > LIMITS.sectionChars || textLength(s.html_ar ?? '') > LIMITS.sectionChars) out.push(`section:${s.key}`);
  }
  if (content.requirements.length > LIMITS.requirements) out.push('requirements');
  if (contentBytes(content) > LIMITS.contentBytes) out.push('size');
  return out;
}

// ---------------------------------------------------------------- change log

export interface VersionMeta {
  version: number;
  status: BrdStatus;
  change_note: string;
  created_at: string;
  author?: string | null;
  restored_from?: number | null;
  archived_at?: string | null;
}

/** Rows of the generated change log: newest first, archived versions marked, restores explained. */
export function changeLogRows(versions: readonly VersionMeta[], lang: 'en' | 'ar' = 'en') {
  const restored = lang === 'ar' ? (n: number) => `استعادة الإصدار ${n}` : (n: number) => `Restored from v${n}`;
  return [...versions]
    .sort((a, b) => b.version - a.version)
    .map((v) => ({
      version: `v${v.version}`,
      date: String(v.created_at ?? '').slice(0, 10),
      status: v.status,
      author: v.author ?? '',
      note: [v.restored_from ? restored(v.restored_from) : '', v.change_note?.trim() ?? ''].filter(Boolean).join(' — '),
      archived: !!v.archived_at,
    }));
}

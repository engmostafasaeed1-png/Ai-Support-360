// Solution Architecture documents (client page /client/solution-architecture): the document model shared by the
// browser editor, the PDF export, the architecture-ai function and the tests. Pure functions only (no Deno or browser
// APIs). Mirror of the database rules in docs/sql/solution-architecture.sql (the database decides; this explains).
//
// - one catalogue of section keys; each document type has its own section template (all other keys are refused);
// - section text is the BRD's allowlisted HTML subset (sanitised by the BRD editor) plus, per section, requirement
//   links to BRD requirement ids (REQ-001 ...) of a linked ticket and diagram blocks (uploaded image or Mermaid text);
// - document details (title, SAP area, owner, status, confidentiality) live on the document row; every saved
//   version keeps a snapshot of them, so the diff shows details changes too;
// - versions are immutable and numbered max + 1 (the database assigns them under a row lock).

import { diffText, isUnchanged, type DiffOp } from './brdDiff.ts';
import { htmlToText, textLength } from './brdModel.ts';
import { scrubSecrets } from './brdSafety.ts';

export const ARCH_TYPES = ['blueprint', 'hld', 'lld', 'integration', 'migration', 'security', 'test', 'cutover', 'adr', 'other'] as const;
export type ArchType = (typeof ARCH_TYPES)[number];
export const ARCH_STATUSES = ['draft', 'in_review', 'approved', 'superseded', 'archived'] as const;
export type ArchStatus = (typeof ARCH_STATUSES)[number];
export const ARCH_CONFIDENTIALITY = ['private', 'shared'] as const;
export type ArchConfidentiality = (typeof ARCH_CONFIDENTIALITY)[number];
export type ArchLanguage = 'en' | 'ar';
/** Same role names as the BRD (brdAccess.ts): client = writer of the owning company, company = reading member. */
export type ArchRole = 'admin' | 'client' | 'company' | 'consultant';

/** Types shown on the Blueprints tab; every other type is on Design documents. */
export const BLUEPRINT_TYPES: readonly ArchType[] = ['blueprint'];

export const TYPE_TITLES: Record<ArchType, { en: string; ar: string; short: string }> = {
  blueprint: { en: 'Solution blueprint', ar: 'المخطط الأساسي للحل', short: 'Blueprint' },
  hld: { en: 'High-level design (HLD)', ar: 'التصميم عالي المستوى (HLD)', short: 'HLD' },
  lld: { en: 'Low-level / technical design', ar: 'التصميم التفصيلي / التقني', short: 'LLD' },
  integration: { en: 'Integration / interface design', ar: 'تصميم التكامل / الواجهات', short: 'Integration' },
  migration: { en: 'Data migration design', ar: 'تصميم ترحيل البيانات', short: 'Migration' },
  security: { en: 'Security & authorisation concept', ar: 'مفهوم الأمن والصلاحيات', short: 'Security' },
  test: { en: 'Test strategy', ar: 'استراتيجية الاختبار', short: 'Test' },
  cutover: { en: 'Cutover plan', ar: 'خطة الانتقال (Cutover)', short: 'Cutover' },
  adr: { en: 'Architecture decision record (ADR)', ar: 'سجل قرار معماري (ADR)', short: 'ADR' },
  other: { en: 'Other', ar: 'أخرى', short: 'Other' },
};

export const SECTION_KEYS = [
  'context', 'scope', 'principles', 'current_landscape', 'target_landscape', 'components', 'integrations', 'data_flows',
  'data_model', 'security', 'non_functional', 'risks', 'decisions', 'open_points', 'process_design', 'org_structure',
  'master_data', 'reporting', 'detailed_design', 'objects', 'error_handling', 'interface_specs', 'migration_objects',
  'migration_approach', 'cleansing', 'reconciliation', 'roles', 'sod', 'test_scope', 'test_approach', 'defects',
  'acceptance', 'cutover_tasks', 'cutover_timeline', 'go_no_go', 'rollback', 'hypercare', 'decision_drivers', 'options',
  'decision', 'consequences', 'notes',
] as const;
export type ArchSectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<ArchSectionKey, { en: string; ar: string }> = {
  context: { en: 'Context and background', ar: 'السياق والخلفية' },
  scope: { en: 'Scope', ar: 'النطاق' },
  principles: { en: 'Architecture principles', ar: 'مبادئ البنية' },
  current_landscape: { en: 'Current landscape (AS-IS)', ar: 'البيئة الحالية (AS-IS)' },
  target_landscape: { en: 'Target landscape (TO-BE)', ar: 'البيئة المستهدفة (TO-BE)' },
  components: { en: 'Components and building blocks', ar: 'المكوّنات والوحدات' },
  integrations: { en: 'Integrations and interfaces', ar: 'التكاملات والواجهات' },
  data_flows: { en: 'Data flows', ar: 'تدفقات البيانات' },
  data_model: { en: 'Data objects and model', ar: 'كائنات البيانات والنموذج' },
  security: { en: 'Security and authorisation', ar: 'الأمن والصلاحيات' },
  non_functional: { en: 'Non-functional requirements', ar: 'المتطلبات غير الوظيفية' },
  risks: { en: 'Risks and mitigations', ar: 'المخاطر وإجراءات التخفيف' },
  decisions: { en: 'Architecture decisions', ar: 'القرارات المعمارية' },
  open_points: { en: 'Open points', ar: 'النقاط المفتوحة' },
  process_design: { en: 'Process and functional design', ar: 'تصميم العمليات والوظائف' },
  org_structure: { en: 'Organisational structure', ar: 'الهيكل التنظيمي' },
  master_data: { en: 'Master data', ar: 'البيانات الرئيسية' },
  reporting: { en: 'Reporting and analytics', ar: 'التقارير والتحليلات' },
  detailed_design: { en: 'Detailed technical design', ar: 'التصميم التقني التفصيلي' },
  objects: { en: 'Development objects (RICEFW)', ar: 'كائنات التطوير (RICEFW)' },
  error_handling: { en: 'Error handling and monitoring', ar: 'معالجة الأخطاء والمراقبة' },
  interface_specs: { en: 'Interface specification and mapping', ar: 'مواصفات الواجهات والربط' },
  migration_objects: { en: 'Migration objects', ar: 'كائنات الترحيل' },
  migration_approach: { en: 'Migration approach and tools', ar: 'منهجية الترحيل والأدوات' },
  cleansing: { en: 'Data cleansing and validation', ar: 'تنقية البيانات والتحقق منها' },
  reconciliation: { en: 'Reconciliation', ar: 'المطابقة' },
  roles: { en: 'Roles and authorisation concept', ar: 'الأدوار ومفهوم الصلاحيات' },
  sod: { en: 'Segregation of duties', ar: 'فصل المهام' },
  test_scope: { en: 'Test scope and levels', ar: 'نطاق الاختبار ومستوياته' },
  test_approach: { en: 'Test approach, environments and data', ar: 'منهجية الاختبار والبيئات والبيانات' },
  defects: { en: 'Defect management', ar: 'إدارة العيوب' },
  acceptance: { en: 'Entry, exit and acceptance criteria', ar: 'معايير الدخول والخروج والقبول' },
  cutover_tasks: { en: 'Cutover tasks and sequence', ar: 'مهام الانتقال وتسلسلها' },
  cutover_timeline: { en: 'Cutover timeline', ar: 'الجدول الزمني للانتقال' },
  go_no_go: { en: 'Go / No-Go criteria', ar: 'معايير الانطلاق / عدم الانطلاق' },
  rollback: { en: 'Rollback plan', ar: 'خطة التراجع' },
  hypercare: { en: 'Hypercare', ar: 'الدعم المكثف بعد الإطلاق' },
  decision_drivers: { en: 'Decision drivers', ar: 'دوافع القرار' },
  options: { en: 'Options considered', ar: 'الخيارات المدروسة' },
  decision: { en: 'Decision', ar: 'القرار' },
  consequences: { en: 'Consequences', ar: 'النتائج المترتبة' },
  notes: { en: 'Notes', ar: 'ملاحظات' },
};

/** Section template per document type (in document order). Mirror of public.sa_type_sections. */
export const TYPE_SECTIONS: Record<ArchType, readonly ArchSectionKey[]> = {
  blueprint: ['context', 'scope', 'process_design', 'org_structure', 'master_data', 'integrations', 'reporting', 'security', 'risks', 'decisions', 'open_points'],
  hld: ['context', 'scope', 'principles', 'target_landscape', 'components', 'integrations', 'data_flows', 'security', 'non_functional', 'risks', 'decisions', 'open_points'],
  lld: ['context', 'detailed_design', 'objects', 'data_model', 'error_handling', 'security', 'non_functional', 'risks', 'open_points'],
  integration: ['context', 'scope', 'integrations', 'interface_specs', 'data_flows', 'error_handling', 'security', 'non_functional', 'risks', 'open_points'],
  migration: ['context', 'scope', 'migration_objects', 'migration_approach', 'cleansing', 'reconciliation', 'risks', 'open_points'],
  security: ['context', 'scope', 'roles', 'sod', 'security', 'risks', 'open_points'],
  test: ['context', 'test_scope', 'test_approach', 'defects', 'acceptance', 'risks', 'open_points'],
  cutover: ['context', 'cutover_tasks', 'cutover_timeline', 'go_no_go', 'rollback', 'hypercare', 'risks', 'open_points'],
  adr: ['context', 'decision_drivers', 'options', 'decision', 'consequences'],
  other: ['context', 'notes', 'open_points'],
};

/** Where "Suggest components and integrations" writes for each type (first key that the template has). */
export function componentTargets(type: ArchType): { components: ArchSectionKey | null; integrations: ArchSectionKey | null } {
  const has = (k: ArchSectionKey) => TYPE_SECTIONS[type].includes(k);
  return {
    components: has('components') ? 'components' : has('detailed_design') ? 'detailed_design' : has('process_design') ? 'process_design' : has('notes') ? 'notes' : null,
    integrations: has('integrations') ? 'integrations' : has('interface_specs') ? 'interface_specs' : has('data_flows') ? 'data_flows' : null,
  };
}

export const LIMITS = {
  title: 200,
  owner: 120,
  sapField: 120,
  note: 500,
  sectionChars: 20_000,
  diagramsPerSection: 10,
  mermaidChars: 5_000,
  caption: 300,
  tracePerSection: 50,
  contentBytes: 600_000,
  commentChars: 4_000,
  imageBytes: 5 * 1024 * 1024,
  imagesPerDocument: 30,
  landscapeName: 80,
  landscapeNotes: 1_000,
  links: 20,
} as const;

export const DIAGRAM_MIME = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
export type DiagramMime = (typeof DIAGRAM_MIME)[number];
export const DIAGRAM_EXT: Record<DiagramMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

export interface TraceRef { ticket_ref: string; req_id: string }
export type Diagram =
  | { id: string; kind: 'image'; asset_id: string; caption: string }
  | { id: string; kind: 'mermaid'; source: string; caption: string };
export interface ArchSection { key: ArchSectionKey; html: string; hidden?: boolean; trace: TraceRef[]; diagrams: Diagram[] }
export interface ArchContent {
  schema: 1;
  type: ArchType;
  language: ArchLanguage;
  sections: ArchSection[];
  /** Landscape systems this document refers to (ids from the company's register). */
  systems: string[];
}
export interface ArchMeta {
  title: string; type: ArchType; status: ArchStatus; confidentiality: ArchConfidentiality;
  sap_area: string; sap_module: string; sap_version: string; owner_name: string;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : fallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REQ_ID = /^REQ-\d{3}$/;
export const TICKET_REF = /^[A-Z0-9]{1,20}$/;

export const isArchType = (v: unknown): v is ArchType => (ARCH_TYPES as readonly string[]).includes(v as string);
export const isArchStatus = (v: unknown): v is ArchStatus => (ARCH_STATUSES as readonly string[]).includes(v as string);

export function emptyArchContent(type: ArchType, language: ArchLanguage = 'en'): ArchContent {
  return { schema: 1, type, language, sections: TYPE_SECTIONS[type].map((key) => ({ key, html: '', trace: [], diagrams: [] })), systems: [] };
}

/** Short random id for a diagram block (letters only, so the contact-detail mask never sees a number). */
export function diagramId(rand: () => number = Math.random): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz';
  return 'd' + Array.from({ length: 9 }, () => abc[Math.floor(rand() * abc.length)]).join('');
}

function normDiagram(raw: unknown): Diagram | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = /^d[a-z]{6,12}$/.test(String(o.id ?? '')) ? String(o.id) : null;
  if (!id) return null;
  const caption = str(o.caption, LIMITS.caption);
  if (o.kind === 'image' && UUID.test(String(o.asset_id ?? ''))) return { id, kind: 'image', asset_id: String(o.asset_id), caption };
  if (o.kind === 'mermaid') return { id, kind: 'mermaid', source: str(o.source, LIMITS.mermaidChars), caption };
  return null;
}

function normTrace(raw: unknown): TraceRef[] {
  const seen = new Set<string>();
  const out: TraceRef[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const ref = String(o.ticket_ref ?? '').toUpperCase();
    const id = String(o.req_id ?? '').toUpperCase();
    if (!TICKET_REF.test(ref) || !REQ_ID.test(id) || seen.has(`${ref}|${id}`)) continue;
    seen.add(`${ref}|${id}`);
    out.push({ ticket_ref: ref, req_id: id });
    if (out.length >= LIMITS.tracePerSection) break;
  }
  return out;
}

/** Defensive read of stored or received content: only the template's sections, each once, in template order. */
export function normalizeArchContent(raw: unknown, fallbackType: ArchType = 'other'): ArchContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type = pick(r.type, ARCH_TYPES, fallbackType);
  const language: ArchLanguage = r.language === 'ar' ? 'ar' : 'en';
  const allowed = TYPE_SECTIONS[type];
  const got = new Map<string, ArchSection>();
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const key = o.key as ArchSectionKey;
    if (!allowed.includes(key) || got.has(key)) continue;
    got.set(key, {
      key,
      html: str(o.html, LIMITS.sectionChars * 2),
      hidden: o.hidden === true,
      trace: normTrace(o.trace),
      diagrams: (Array.isArray(o.diagrams) ? o.diagrams : []).map(normDiagram).filter((d): d is Diagram => !!d).slice(0, LIMITS.diagramsPerSection),
    });
  }
  // Template order, missing sections added empty.
  const sections = allowed.map((key) => got.get(key) ?? { key, html: '', trace: [], diagrams: [] });
  const systems = Array.from(new Set((Array.isArray(r.systems) ? r.systems : []).map(String).filter((x) => UUID.test(x)))).slice(0, 50);
  return { schema: 1, type, language, sections, systems };
}

export function contentBytes(c: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(c)).length; } catch { return Number.MAX_SAFE_INTEGER; }
}

/** Problems that block saving (the database refuses the same things). */
export function archProblems(c: ArchContent): string[] {
  const out: string[] = [];
  for (const s of c.sections) {
    if (textLength(s.html) > LIMITS.sectionChars) out.push(`section:${s.key}`);
    if (s.diagrams.length > LIMITS.diagramsPerSection) out.push(`diagrams:${s.key}`);
  }
  if (contentBytes(c) > LIMITS.contentBytes) out.push('size');
  return out;
}

export function metaProblems(m: Pick<ArchMeta, 'title' | 'owner_name'>): string[] {
  const out: string[] = [];
  if (!m.title.trim()) out.push('title');
  if (m.title.length > LIMITS.title) out.push('title_long');
  if (m.owner_name.length > LIMITS.owner) out.push('owner_long');
  return out;
}

/** Mirror of the database rule: the next version is the highest existing number + 1. */
export function nextVersionNumber(existing: readonly number[]): number {
  const v = existing.filter((n) => Number.isInteger(n) && n > 0);
  return (v.length ? Math.max(...v) : 0) + 1;
}

// ---------------------------------------------------------------- status rules (mirror of sa_set_status)

/** Approving needs a saved version; archived documents can only be brought back to draft. */
export function allowedStatuses(current: ArchStatus, latestVersion: number): ArchStatus[] {
  if (current === 'archived') return ['draft'];
  return ARCH_STATUSES.filter((s) => s !== current && (s !== 'approved' || latestVersion > 0));
}

/** Saving a new version of an approved document puts it back in review (the approval was for the older version). */
export function statusAfterNewVersion(current: ArchStatus): ArchStatus {
  return current === 'approved' ? 'in_review' : current;
}

// ---------------------------------------------------------------- access (mirror of sa_role_for)

export interface ArchAccessInput {
  isAdmin: boolean;
  /** Document belongs to a company (tenant) — otherwise to one client account. */
  tenantScoped: boolean;
  isCreator: boolean;
  isOwnerAccount: boolean;
  /** Accepted member of the document's company, with that member's organisation role. */
  orgRole: 'owner' | 'admin' | 'manager' | 'member' | null;
  confidentiality: ArchConfidentiality;
  archived: boolean;
  /** The BRD reader rule (brd_role_for) said 'consultant' on at least one linked ticket. */
  consultantOnLinkedTicket: boolean;
  /** Active NDA signed by both sides with that ticket's client. */
  ndaBothSigned: boolean;
  requireNda: boolean;
}

export const ORG_WRITER_ROLES = ['owner', 'admin', 'manager'] as const;

export function archRole(i: ArchAccessInput): ArchRole | null {
  if (i.isAdmin) return 'admin';
  if (!i.tenantScoped) { if (i.isOwnerAccount) return 'client'; }
  else if (i.orgRole) return i.isCreator || (ORG_WRITER_ROLES as readonly string[]).includes(i.orgRole) ? 'client' : 'company';
  if (i.confidentiality === 'shared' && !i.archived && i.consultantOnLinkedTicket && (!i.requireNda || i.ndaBothSigned)) return 'consultant';
  return null;
}

/** Writers: the owning company's writers and admins, never while the document is archived (except to restore). */
export function canWriteArch(role: ArchRole | null, archived: boolean): boolean {
  return (role === 'client' || role === 'admin') && !archived;
}
/** Every reader may comment; consultants and members never edit. */
export const canCommentArch = (role: ArchRole | null) => role !== null;
/** Consultants never see the working draft, only saved versions. */
export const canSeeDraft = (role: ArchRole | null) => role === 'client' || role === 'admin';

// ---------------------------------------------------------------- traceability

export interface BrdRequirementRef { ticket_id: string; ticket_ref: string; req_id: string; description: string }

/** Requirement -> sections that cover it, plus the requirements no section covers yet. */
export function traceMatrix(c: ArchContent, reqs: readonly BrdRequirementRef[]) {
  const rows = reqs.map((r) => ({
    ...r,
    sections: c.sections.filter((s) => !s.hidden && s.trace.some((t) => t.ticket_ref === r.ticket_ref && t.req_id === r.req_id)).map((s) => s.key),
  }));
  const known = new Set(reqs.map((r) => `${r.ticket_ref}|${r.req_id}`));
  const unknown = c.sections.flatMap((s) => s.trace.filter((t) => !known.has(`${t.ticket_ref}|${t.req_id}`)).map((t) => ({ section: s.key, ...t })));
  return { rows, uncovered: rows.filter((r) => r.sections.length === 0), unknown };
}

// ---------------------------------------------------------------- diff

export interface ArchSectionDiff {
  key: string; title: string; ops: DiffOp[]; changed: boolean; visibility?: { before: boolean; after: boolean }; moved?: boolean;
}

function metaText(m: Partial<ArchMeta> | null | undefined): string {
  const x = m ?? {};
  return [`Title: ${x.title ?? ''}`, `Type: ${x.type ?? ''}`, `Status: ${x.status ?? ''}`, `Owner: ${x.owner_name ?? ''}`,
    `SAP area: ${x.sap_area ?? ''}`, `Module: ${x.sap_module ?? ''}`, `Version: ${x.sap_version ?? ''}`, `Confidentiality: ${x.confidentiality ?? ''}`].join('\n');
}
function extrasText(s: ArchSection | undefined): string {
  if (!s) return '';
  const trace = s.trace.map((t) => `${t.ticket_ref}/${t.req_id}`).join(', ');
  const diagrams = s.diagrams.map((d) => (d.kind === 'mermaid' ? `[diagram ${d.caption}]\n${d.source}` : `[image ${d.caption}]`)).join('\n');
  return [trace ? `Requirements: ${trace}` : '', diagrams].filter(Boolean).join('\n');
}

/** Per-section comparison of two versions (details, every section with its links and diagrams). */
export function diffArch(before: { content: ArchContent; meta?: Partial<ArchMeta> | null }, after: { content: ArchContent; meta?: Partial<ArchMeta> | null }, lang: ArchLanguage = 'en'): ArchSectionDiff[] {
  const out: ArchSectionDiff[] = [];
  const m = diffText(metaText(before.meta), metaText(after.meta));
  out.push({ key: 'details', title: lang === 'ar' ? 'بيانات الوثيقة' : 'Document details', ops: m, changed: !isUnchanged(m) });
  const orderA = before.content.sections.map((s) => s.key);
  const orderB = after.content.sections.map((s) => s.key);
  for (const sb of after.content.sections) {
    const sa = before.content.sections.find((s) => s.key === sb.key);
    const ops = diffText([htmlToText(sa?.html ?? ''), extrasText(sa)].filter(Boolean).join('\n'), [htmlToText(sb.html), extrasText(sb)].filter(Boolean).join('\n'));
    const vb = !(sa?.hidden ?? false);
    const va = !sb.hidden;
    const moved = orderA.indexOf(sb.key) !== orderB.indexOf(sb.key);
    out.push({
      key: sb.key, title: SECTION_TITLES[sb.key][lang], ops, changed: !isUnchanged(ops) || vb !== va,
      ...(vb !== va ? { visibility: { before: vb, after: va } } : {}), ...(moved ? { moved } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------- landscape register (no credentials)

export const LANDSCAPE_ROLES = ['DEV', 'QAS', 'PRD', 'SBX', 'TRN', 'PRE', 'OTHER'] as const;
export type LandscapeRole = (typeof LANDSCAPE_ROLES)[number];
export const HOSTING = ['on_premise', 'private_cloud', 'rise', 'public_cloud', 'hyperscaler', 'other'] as const;
export type Hosting = (typeof HOSTING)[number];

export interface LandscapeSystem {
  id?: string; name: string; sid: string; role: LandscapeRole; product: string; release: string; hosting: Hosting; notes: string;
}

/** Words that announce a credential. Mirror of public.sa_text_has_secret (the database refuses the same). */
const SECRET_WORDS = /\b(pass(?:word|wort|wd|phrase)?|pwd|kennwort|secret|token|api[ _-]?key|private[ _-]?key|access[ _-]?key|client[ _-]?secret|credentials?|login\s*[:=]|user(?:name)?\s*[:=]|logon\s*[:=])/i;
const SECRET_ARABIC = /(كلمة\s*(?:ال)?(?:مرور|سر|السر)|الرقم\s*السري|رمز\s*(?:الدخول|المرور))/;
const CONN_STRING = /[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i;

/** True when a landscape text looks like it carries a password, key, token or connection secret. */
export function looksLikeSecret(text: string): boolean {
  const s = String(text ?? '');
  if (!s.trim()) return false;
  if (SECRET_WORDS.test(s) || SECRET_ARABIC.test(s) || CONN_STRING.test(s)) return true;
  return scrubSecrets(s).removed > 0;
}

export function landscapeProblems(s: LandscapeSystem): string[] {
  const out: string[] = [];
  if (!s.name.trim()) out.push('name');
  if (s.name.length > LIMITS.landscapeName) out.push('name_long');
  if (s.sid && !/^[A-Z][A-Z0-9]{2}$/.test(s.sid)) out.push('sid');
  if (!(LANDSCAPE_ROLES as readonly string[]).includes(s.role)) out.push('role');
  if (!(HOSTING as readonly string[]).includes(s.hosting)) out.push('hosting');
  if (s.notes.length > LIMITS.landscapeNotes) out.push('notes_long');
  for (const k of ['name', 'product', 'release', 'notes'] as const) if (looksLikeSecret(s[k])) { out.push('secret'); break; }
  return out;
}

// ---------------------------------------------------------------- files

/** Allowlist check before an upload (the bucket rule and the database check type, size and name again). */
export function diagramFileProblem(file: { name: string; type: string; size: number }): 'type' | 'size' | null {
  const ext = String(file.name).toLowerCase().split('.').pop() ?? '';
  const okType = (DIAGRAM_MIME as readonly string[]).includes(file.type);
  const okExt = ['png', 'jpg', 'jpeg', 'svg'].includes(ext);
  if (!okType || !okExt) return 'type';
  if (file.size <= 0 || file.size > LIMITS.imageBytes) return 'size';
  return null;
}

export function docRef(id: string): string {
  return String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'DOC';
}

/** ARCH_<type>_<ref>_v<N>_<YYYY-MM-DD>.pdf */
export function archFileName(type: ArchType, ref: string, version: number, date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const safe = String(ref || 'DOC').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'DOC';
  return `ARCH_${TYPE_TITLES[type].short.replace(/[^A-Za-z]/g, '')}_${safe}_v${Math.max(1, Math.floor(version))}_${d}.pdf`;
}

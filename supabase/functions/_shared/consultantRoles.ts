// Consultant professional roles: the built-in copy of the admin-editable catalogue (docs/sql/consultant-roles.sql seeds the
// same rows), the legacy mapping, role-aware profile fields, role fit for matching and the interview focus per category.
// Pure TypeScript, used by the browser (src/lib/consultantRoles.ts) and the edge functions.

export const ROLE_CATEGORIES = [
  'delivery_management', 'architecture', 'functional', 'technical', 'basis_security', 'data_analytics',
  'integration_btp', 'testing_quality', 'change_training', 'presales_sales', 'other',
] as const;
export type RoleCategory = typeof ROLE_CATEGORIES[number];

export const CATEGORY_LABELS: Record<RoleCategory, { en: string; ar: string }> = {
  delivery_management: { en: 'Delivery management', ar: 'إدارة التسليم والمشاريع' },
  architecture: { en: 'Architecture', ar: 'الهندسة المعمارية للحلول' },
  functional: { en: 'Functional', ar: 'وظيفي' },
  technical: { en: 'Technical', ar: 'تقني' },
  basis_security: { en: 'Basis & security', ar: 'Basis والأمن' },
  data_analytics: { en: 'Data & analytics', ar: 'البيانات والتحليلات' },
  integration_btp: { en: 'Integration & BTP', ar: 'التكامل و BTP' },
  testing_quality: { en: 'Testing & quality', ar: 'الاختبار والجودة' },
  change_training: { en: 'Change & training', ar: 'إدارة التغيير والتدريب' },
  presales_sales: { en: 'Pre-sales & sales', ar: 'ما قبل البيع والمبيعات' },
  other: { en: 'Other', ar: 'أخرى' },
};

export type RoleEntry = { key: string; label_en: string; label_ar: string; category: RoleCategory; enabled: boolean; sort: number; legacy_labels?: string[] };

const r = (key: string, category: RoleCategory, label_en: string, label_ar: string, sort: number, legacy_labels: string[] = []): RoleEntry =>
  ({ key, category, label_en, label_ar, sort, enabled: true, legacy_labels });

/** Built-in catalogue (used until the database catalogue exists, and as its seed). */
export const DEFAULT_ROLE_CATALOG: RoleEntry[] = [
  r('project_manager', 'delivery_management', 'SAP Project Manager', 'مدير مشروع SAP', 10, ['Project / program manager', 'Project manager']),
  r('program_manager', 'delivery_management', 'SAP Program Manager', 'مدير برنامج SAP', 20, ['Program manager']),
  r('delivery_manager', 'delivery_management', 'SAP Delivery Manager', 'مدير تسليم SAP', 30, ['Delivery manager']),
  r('pmo_lead', 'delivery_management', 'PMO Lead', 'قائد مكتب إدارة المشاريع (PMO)', 40, ['PMO']),
  r('support_manager', 'delivery_management', 'SAP Support / AMS Manager', 'مدير دعم SAP / AMS', 50, ['SAP Support Manager', 'Support manager']),
  r('solution_architect', 'architecture', 'SAP Solution Architect', 'مهندس حلول SAP', 60, ['Solution / enterprise architect', 'architect', 'Solution architect']),
  r('enterprise_architect', 'architecture', 'SAP Enterprise Architect', 'مهندس معماري مؤسسي SAP', 70, ['Enterprise architect']),
  r('technical_architect', 'architecture', 'SAP Technical Architect', 'مهندس معماري تقني SAP', 80, ['Technical architect']),
  r('functional_lead', 'functional', 'Functional Lead', 'قائد وظيفي', 90, ['Functional lead']),
  r('functional', 'functional', 'Functional Consultant', 'مستشار وظيفي', 100, ['Functional consultant']),
  r('techno_functional', 'functional', 'Techno-functional Consultant', 'مستشار تقني-وظيفي', 110, ['Techno-functional']),
  r('business_analyst', 'functional', 'Business Analyst / Process Consultant', 'محلل أعمال / مستشار عمليات', 120, ['Business analyst']),
  r('technical', 'technical', 'Technical Consultant / Developer (ABAP)', 'مستشار تقني / مطوّر (ABAP)', 130, ['Technical / developer (ABAP, Fiori)', 'Developer']),
  r('fiori_developer', 'technical', 'Fiori / UI5 Developer', 'مطوّر Fiori / UI5', 140, ['Fiori developer']),
  r('basis', 'basis_security', 'Basis Consultant', 'مستشار Basis', 150, ['Basis / security / admin', 'Basis administrator']),
  r('security_grc', 'basis_security', 'Security & GRC Consultant', 'مستشار الأمن و GRC', 160, ['Security consultant', 'GRC consultant']),
  r('data_analytics', 'data_analytics', 'Data & Analytics Consultant (BW, SAC, Datasphere)', 'مستشار البيانات والتحليلات (BW, SAC, Datasphere)', 170, ['Data & analytics (BW, SAC, Datasphere)']),
  r('data_migration', 'data_analytics', 'Data Migration Consultant', 'مستشار ترحيل البيانات', 180, ['Data migration']),
  r('master_data', 'data_analytics', 'Master Data / MDG Consultant', 'مستشار البيانات الرئيسية / MDG', 190, ['MDG consultant']),
  r('integration', 'integration_btp', 'Integration Consultant (CPI, PI/PO)', 'مستشار التكامل (CPI, PI/PO)', 200, ['Integration (CPI, PI/PO, BTP)']),
  r('btp_developer', 'integration_btp', 'BTP Developer / Consultant', 'مطوّر / مستشار BTP', 210, ['BTP developer']),
  r('test_lead', 'testing_quality', 'Test / QA Lead', 'قائد الاختبار والجودة', 220, ['Test manager', 'QA lead']),
  r('tester', 'testing_quality', 'Tester', 'مختبِر', 230, ['Test consultant']),
  r('change_lead', 'change_training', 'Change Management Lead', 'قائد إدارة التغيير', 240, ['Change manager']),
  r('training_lead', 'change_training', 'Training Lead / Trainer', 'قائد التدريب / مدرّب', 250, ['Trainer']),
  r('presales', 'presales_sales', 'Pre-sales Consultant', 'مستشار ما قبل البيع', 260, ['Pre-sales']),
  r('solution_sales', 'presales_sales', 'Sales / Solution Consultant', 'مستشار مبيعات / حلول', 270, ['Sales consultant', 'Solution consultant']),
  r('other', 'other', 'Other SAP role', 'دور SAP آخر', 999),
];

export const MAX_ROLES = 5; // one primary + up to 4 more
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The catalogue key for a stored value (a key, a catalogue label or a known legacy label); null when unknown. */
export function roleKeyFor(value: string | null | undefined, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): string | null {
  if (!value || !value.trim()) return null;
  const v = norm(value);
  for (const e of catalog) {
    if (e.key === v || norm(e.label_en) === v || e.label_ar.trim() === value.trim() || (e.legacy_labels ?? []).some((l) => norm(l) === v)) return e.key;
  }
  // Also accept the built-in legacy labels when an older database catalogue lacks them.
  if (catalog !== DEFAULT_ROLE_CATALOG) return roleKeyFor(value, DEFAULT_ROLE_CATALOG);
  return null;
}

/** Stored roles as catalogue keys, primary first, duplicates removed. Unknown legacy values stay (shown as "Other"). */
export function normalizeRoles(values: readonly string[] | null | undefined, primary?: string | null, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): { primary: string | null; roles: string[] } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primary ?? '', ...(values ?? [])]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const v = roleKeyFor(raw, catalog) ?? raw.trim().slice(0, 80);
    const id = v.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(v);
  }
  const first = out[0] ?? null;
  return { primary: first === null ? null : (roleKeyFor(first, catalog) ?? 'other'), roles: out };
}

export function roleEntry(value: string, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): RoleEntry | null {
  const key = roleKeyFor(value, catalog);
  return key ? catalog.find((e) => e.key === key) ?? DEFAULT_ROLE_CATALOG.find((e) => e.key === key) ?? null : null;
}

export function categoryOf(value: string, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): RoleCategory {
  return roleEntry(value, catalog)?.category ?? 'other';
}

export function categoriesOf(values: readonly string[] | null | undefined, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): RoleCategory[] {
  return [...new Set((values ?? []).filter((v) => typeof v === 'string' && v.trim()).map((v) => categoryOf(v, catalog)))];
}

/** Label in the chosen language; unknown legacy values show as typed. */
export function roleLabel(value: string, lang: string = 'en', catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): string {
  const e = roleEntry(value, catalog);
  if (!e) return value;
  return lang.startsWith('ar') ? e.label_ar : e.label_en;
}

export const isRoleKey = (v: unknown): v is string => typeof v === 'string' && KEY_RE.test(v);

// ------------------------------------------------------------- role-aware profile fields

const HANDS_ON: RoleCategory[] = ['functional', 'technical', 'basis_security', 'data_analytics', 'integration_btp', 'architecture', 'testing_quality'];
const LEADERSHIP: RoleCategory[] = ['delivery_management', 'architecture', 'testing_quality', 'change_training'];

export type DetailKind = 'list' | 'number' | 'choice' | 'text';
export type RoleDetailSpec = { key: string; kind: DetailKind; cats: RoleCategory[]; en: string; ar: string; options?: string[] };
const MGMT: RoleCategory[] = ['delivery_management'];
const SIZE = ['Under 100k USD', '100k-500k USD', '500k-1M USD', '1M-5M USD', 'Over 5M USD'];

/** Role details per category (stored in consultants.role_details). Lists are admin-editable (settings.lists) plus free "other" text. */
export const ROLE_DETAIL_SPEC: RoleDetailSpec[] = [
  { key: 'years_managing', kind: 'number', cats: MGMT, en: 'Years managing teams', ar: 'سنوات إدارة الفرق' },
  { key: 'team_size_managed', kind: 'number', cats: LEADERSHIP, en: 'Largest team you managed (people)', ar: 'أكبر فريق أدرته (عدد الأشخاص)' },
  { key: 'budget_range', kind: 'choice', cats: MGMT, en: 'Largest budget managed', ar: 'أكبر ميزانية أدرتها', options: SIZE },
  { key: 'methodologies', kind: 'list', cats: LEADERSHIP, en: 'Delivery methodologies', ar: 'منهجيات التسليم', options: ['SAP Activate', 'Agile / Scrum', 'SAFe', 'Waterfall', 'Hybrid', 'PRINCE2', 'PMP', 'ITIL'] },
  { key: 'projects_delivered', kind: 'number', cats: ['delivery_management', 'architecture'], en: 'Projects delivered', ar: 'المشاريع المُسلَّمة' },
  { key: 'go_lives_led', kind: 'number', cats: MGMT, en: 'Go-lives led', ar: 'عمليات التشغيل الفعلي التي قدتها' },
  { key: 'pm_tools', kind: 'list', cats: ['delivery_management', 'testing_quality'], en: 'Delivery tools', ar: 'أدوات التسليم', options: ['Jira', 'MS Project', 'SAP Solution Manager', 'SAP Cloud ALM', 'SAP Signavio', 'ServiceNow', 'Azure DevOps', 'Smartsheet'] },
  { key: 'architecture_domains', kind: 'list', cats: ['architecture'], en: 'Architecture domains', ar: 'مجالات الهندسة المعمارية', options: ['Business', 'Application', 'Data', 'Integration', 'Technology / infrastructure', 'Security'] },
  { key: 'landscape_types', kind: 'list', cats: ['architecture', 'basis_security'], en: 'Landscape types', ar: 'أنواع البيئات', options: ['On-premise', 'RISE with SAP', 'Public cloud', 'Hybrid', 'Multi-cloud'] },
  { key: 'integration_patterns', kind: 'list', cats: ['architecture', 'integration_btp'], en: 'Integration patterns', ar: 'أنماط التكامل', options: ['API-led', 'Event-driven', 'IDoc / EDI', 'File-based', 'Side-by-side on BTP', 'Point-to-point'] },
  { key: 'frameworks', kind: 'list', cats: ['architecture'], en: 'Architecture frameworks', ar: 'أطر الهندسة المعمارية', options: ['TOGAF', 'ArchiMate', 'Zachman', 'SAP EA Framework', 'Clean core'] },
  { key: 'reference_architectures', kind: 'list', cats: ['architecture'], en: 'Reference architectures', ar: 'المعماريات المرجعية', options: ['SAP reference architecture', 'RISE reference', 'BTP reference', 'Industry best practices'] },
  { key: 'security_compliance', kind: 'text', cats: ['architecture', 'basis_security'], en: 'Security, audit and compliance experience', ar: 'خبرة الأمن والتدقيق والامتثال' },
  { key: 'basis_platforms', kind: 'list', cats: ['basis_security'], en: 'Platforms and databases', ar: 'المنصات وقواعد البيانات', options: ['SAP HANA', 'Sybase ASE', 'Oracle', 'MS SQL Server', 'IBM Db2', 'NetWeaver ABAP', 'NetWeaver Java', 'SAP BTP', 'Linux', 'Windows'] },
  { key: 'cloud_ops', kind: 'list', cats: ['basis_security'], en: 'HANA and cloud operations', ar: 'تشغيل HANA والسحابة', options: ['HANA operations', 'RISE operations', 'Azure', 'AWS', 'Google Cloud', 'Backup and DR', 'System copies', 'Upgrades'] },
  { key: 'data_tools', kind: 'list', cats: ['data_analytics'], en: 'Data and analytics tools', ar: 'أدوات البيانات والتحليلات', options: ['SAP Analytics Cloud', 'Datasphere', 'BW/4HANA', 'BW 7.x', 'HANA modeling', 'Embedded analytics', 'SAP AI Core / ML', 'Databricks'] },
  { key: 'solution_areas', kind: 'list', cats: ['presales_sales', 'architecture'], en: 'Solution areas you position or design', ar: 'مجالات الحلول التي تعرضها أو تصممها', options: ['Finance', 'Procurement', 'Supply chain', 'Sales & service', 'Human resources', 'Manufacturing', 'Asset management', 'Analytics', 'BTP & integration', 'Industry solutions'] },
  { key: 'deal_size_range', kind: 'choice', cats: ['presales_sales'], en: 'Typical deal size', ar: 'حجم الصفقة المعتاد', options: SIZE },
  { key: 'demos_delivered', kind: 'number', cats: ['presales_sales'], en: 'Demos delivered', ar: 'العروض التوضيحية المقدَّمة' },
  { key: 'workshops_delivered', kind: 'number', cats: ['presales_sales', 'change_training'], en: 'Workshops delivered', ar: 'ورش العمل المقدَّمة' },
  { key: 'proposals_written', kind: 'number', cats: ['presales_sales'], en: 'Proposals written', ar: 'العروض المكتوبة' },
  { key: 'regions', kind: 'list', cats: ['presales_sales'], en: 'Regions covered', ar: 'المناطق المغطّاة', options: ['GCC', 'Middle East', 'North Africa', 'Africa', 'Europe', 'Asia', 'Americas'] },
  { key: 'presales_experience', kind: 'text', cats: ['presales_sales'], en: 'Deal and demo experience', ar: 'خبرة الصفقات والعروض التوضيحية' },
  { key: 'testing_tools', kind: 'list', cats: ['testing_quality'], en: 'Testing tools', ar: 'أدوات الاختبار', options: ['Tricentis Tosca', 'SAP CBTA', 'Worksoft', 'Micro Focus ALM', 'Jira Xray', 'Selenium', 'Cloud ALM test management'] },
  { key: 'test_types', kind: 'list', cats: ['testing_quality'], en: 'Test types', ar: 'أنواع الاختبار', options: ['Unit', 'Integration', 'Regression', 'UAT', 'Performance', 'Security', 'Automation'] },
  { key: 'trainings_delivered', kind: 'number', cats: ['change_training'], en: 'Trainings delivered', ar: 'الدورات التدريبية المقدَّمة' },
  { key: 'training_formats', kind: 'list', cats: ['change_training'], en: 'Training formats', ar: 'أشكال التدريب', options: ['Classroom', 'Virtual', 'E-learning', 'Train-the-trainer', 'Job aids', 'SAP Enable Now'] },
];

/** Fields that belong only to some role categories (technical fields + every role detail). Fields not listed apply to everybody. */
export const ROLE_FIELD_CATEGORIES: Record<string, RoleCategory[]> = {
  sap_technologies: HANDS_ON,
  certifications: HANDS_ON,
  ...Object.fromEntries(ROLE_DETAIL_SPEC.map((d) => [d.key, d.cats])),
};
/** The role-detail fields (stored in consultants.role_details). */
export const ROLE_DETAIL_FIELDS: readonly string[] = ROLE_DETAIL_SPEC.map((d) => d.key);
export type RoleDetailField = string;
export type RoleDetails = Record<string, string | number | string[] | null | undefined>;

/** The options of a list/choice field: the admin's list when set, else the built-in one. */
export function detailOptions(spec: RoleDetailSpec, settings?: RoleSettings | null): string[] {
  const own = settings?.lists?.[spec.key];
  return Array.isArray(own) && own.length ? own.filter((x) => typeof x === 'string' && x.trim()).slice(0, 40) : spec.options ?? [];
}

/** Cleans role details for saving: known keys, right types, limits (mirror of consultant_roles_guard). Returns problems too. */
export function cleanRoleDetails(raw: RoleDetails, hasContact: (s: string) => boolean): { details: RoleDetails; problems: string[] } {
  const details: RoleDetails = {};
  const problems: string[] = [];
  for (const spec of ROLE_DETAIL_SPEC) {
    const v = raw[spec.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (spec.kind === 'number') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000) { problems.push(spec.key); continue; }
      details[spec.key] = n;
    } else if (spec.kind === 'list') {
      const list = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, 12);
      if (list.some(hasContact)) { problems.push(spec.key); continue; }
      if (list.length) details[spec.key] = list;
    } else {
      const text = String(v).trim().slice(0, 600);
      if (hasContact(text)) { problems.push(spec.key); continue; }
      if (text) details[spec.key] = text;
    }
  }
  return { details, problems };
}

/**
 * Whether a profile field applies to someone with these roles. No roles yet, or only "Other": today's fields keep applying
 * (nothing changes for existing consultants) and the new role-detail fields stay away. Technical fields never apply to
 * people who have only non-technical roles, so admins can mark them required without blocking managers or pre-sales.
 */
export function fieldAppliesToRoles(field: string, roles: readonly string[] | null | undefined, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): boolean {
  const cats = ROLE_FIELD_CATEGORIES[field];
  if (!cats) return true;
  const isDetail = (ROLE_DETAIL_FIELDS as readonly string[]).includes(field);
  const mine = categoriesOf(roles, catalog);
  if (mine.length === 0) return !isDetail;
  return mine.some((c) => cats.includes(c) || (c === 'other' && !isDetail));
}

/** Required only when the admin rule says so AND the field applies to the consultant's roles. */
export function isRequiredForRoles(field: string, adminRequired: boolean, roles: readonly string[] | null | undefined, catalog?: RoleEntry[]): boolean {
  return adminRequired && fieldAppliesToRoles(field, roles, catalog);
}

// ------------------------------------------------------------- matching

/** How well a consultant's roles cover one needed role (0..1). Exact 1; techno-functional 0.8 for functional/technical; same category 0.6; an architect 0.5. */
export function roleFit(need: string, have: readonly string[] | null | undefined, catalog: RoleEntry[] = DEFAULT_ROLE_CATALOG): number {
  const needKey = roleKeyFor(need, catalog) ?? need;
  const keys = normalizeRoles(have, null, catalog).roles.map((h) => roleKeyFor(h, catalog) ?? 'other');
  if (keys.includes(needKey)) return 1;
  if (keys.includes('techno_functional') && (needKey === 'functional' || needKey === 'technical')) return 0.8;
  const needCat = (ROLE_CATEGORIES as readonly string[]).includes(needKey) ? (needKey as RoleCategory) : categoryOf(needKey, catalog);
  if (needCat !== 'other' && keys.some((k) => categoryOf(k, catalog) === needCat)) return 0.6;
  if (keys.some((k) => categoryOf(k, catalog) === 'architecture') && ['functional', 'technical', 'integration_btp', 'basis_security', 'data_analytics'].includes(needCat)) return 0.5;
  return 0;
}

/** The roles a ticket asks for ("Type of help needed"), only valid keys, at most 8. */
export function helpRolesFrom(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(isRoleKey))].slice(0, 8) : [];
}

// ------------------------------------------------------------- interview

export type InterviewFocus = 'manager' | 'architect' | 'presales' | 'technical' | 'functional';
export function interviewFocusFor(primary: string | null | undefined, catalog?: RoleEntry[]): InterviewFocus {
  const c = primary ? categoryOf(primary, catalog) : 'functional';
  if (c === 'delivery_management' || c === 'change_training') return 'manager';
  if (c === 'architecture') return 'architect';
  if (c === 'presales_sales') return 'presales';
  if (['technical', 'basis_security', 'integration_btp', 'data_analytics'].includes(c)) return 'technical';
  return 'functional';
}

export const INTERVIEW_FOCUS_TEXT: Record<InterviewFocus, { questions: string; rubric: string }> = {
  manager: {
    questions: 'The consultant is a manager (project, program, delivery, PMO, change or training lead). Ask about SAP delivery: planning and methodology (SAP Activate, hybrid), risk and issue management, stakeholder and steering-committee communication, budget and effort control, governance, cut-over and hypercare, leading mixed functional/technical teams. Use their SAP areas for context, not for configuration detail.',
    rubric: 'Score this candidate as a manager: delivery method, risk handling, stakeholder communication, budget/governance and leadership. Do NOT lower the score for missing configuration, code or transaction-level detail.',
  },
  architect: {
    questions: 'The consultant is an architect. Ask about design trade-offs, system landscape and deployment options (on-premise, RISE, public cloud), clean core and extensibility, integration patterns, security and authorisation design, data and performance considerations, and how they justify decisions to business and IT.',
    rubric: 'Score this candidate as an architect: quality of design reasoning, trade-offs, landscape, integration and security judgement. Do NOT lower the score for not knowing individual transaction codes or code syntax.',
  },
  presales: {
    questions: 'The consultant works in pre-sales or sales. Ask about customer discovery, positioning SAP solutions against business needs, building and running a demo, writing proposals and scope, objection handling, and SAP licensing basics (concepts only). Never ask for or accept concrete prices, discounts or commercial promises.',
    rubric: 'Score this candidate as pre-sales/sales: discovery, solution positioning, demo and proposal skills, objection handling and correct licensing concepts. Do NOT lower the score for missing configuration or code detail, and never reward concrete pricing claims.',
  },
  technical: { questions: '', rubric: '' },
  functional: { questions: '', rubric: '' },
};

// ------------------------------------------------------------- rates and verification

export type RoleSettings = { rate_ranges?: Partial<Record<RoleCategory, { min?: number; max?: number }>>; lists?: Record<string, string[]> };

/** The admin's suggested hourly-rate range for the primary role's category, or null when none is set. */
export function suggestedRateRange(settings: RoleSettings | null | undefined, primary: string | null | undefined, catalog?: RoleEntry[]): { category: RoleCategory; min: number; max: number } | null {
  if (!primary) return null;
  const category = categoryOf(primary, catalog);
  const r0 = settings?.rate_ranges?.[category];
  const min = Number(r0?.min), max = Number(r0?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null;
  return { category, min, max };
}

/** Default "still to check" items when an admin approves: certificates for hands-on roles, LinkedIn/references otherwise. */
export function defaultVerificationKinds(roles: readonly string[] | null | undefined, catalog?: RoleEntry[]): string[] {
  const cats = categoriesOf(roles, catalog);
  if (cats.length === 0 || cats.some((c) => HANDS_ON.includes(c) || c === 'other')) return ['certificates'];
  return ['links', 'references'];
}

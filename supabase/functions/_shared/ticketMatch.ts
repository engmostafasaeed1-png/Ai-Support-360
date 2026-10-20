/**
 * Deterministic ticket-to-consultant matching (no AI model). The same inputs always give the same ranking, every point is explainable
 * ("why this match") and every weight can be tuned by an administrator (platform setting `match_weights`).
 *
 * 1. extractTicketSignals: modules, sub-modules, T-codes, error messages, SAP Notes, products, country, deployment and roles found in the
 *    ticket's chosen areas and in its title/description/area details (English and Arabic).
 * 2. hardFilter: verified, active, not excluded, SAP area overlap, language, and for critical tickets only consultants who can respond now.
 * 3. scoreConsultant: weighted, bounded criteria; criteria the ticket says nothing about are left out and the rest scaled to 100.
 * 4. rankConsultants: all eligible consultants are scored before the best are selected.
 * Used by the ai-ticket function (server ranking) and by the client directory (best-match sort and chips).
 */
import { contextFit } from './contextFit.ts';

// ---------------------------------------------------------------- modules

export type ModuleKind = 'module' | 'product';
export type ModuleDef = { code: string; family: string; kind: ModuleKind; label: string; patterns: RegExp[] };

const def = (code: string, family: string, label: string, patterns: RegExp[], kind: ModuleKind = 'module'): ModuleDef => ({ code, family, kind, label, patterns });

/** Canonical SAP modules. Ticket area names, consultant skill names, certificate names and free text all map to these codes. */
export const MODULES: ModuleDef[] = [
  def('FI', 'finance', 'SAP FI', [/\bfi\b|\bfico\b|financial accounting|general ledger|accounts? payable|accounts? receivable|asset accounting|bank accounting|cash management|month[- ]end|year[- ]end|period[- ]end|financial clos|treasury|\bvat\b|withholding tax|e-?invoic|central finance|zatca|fatoora|المالي|المالية|محاسب|الإقفال|إقفال|الأستاذ العام|الذمم|الأصول الثابتة|ضريبة القيمة المضافة|الفوترة الإلكترونية|فاتورة إلكترونية/i]),
  def('CO', 'finance', 'SAP CO', [/\bco\b(?![- ]?\d)|controlling|cost cent(?:er|re)|internal orders?|product costing|profitability analysis|co-pa|profit cent(?:er|re)|material ledger|actual costing|مراكز التكلفة|محاسبة التكاليف|الربحية/i]),
  def('MM', 'logistics', 'SAP MM', [/\bmm\b|purchas|procurement|purchase requisition|inventory management|goods (?:receipt|issue)|gr\/ir|invoice verification|subcontract|consignment|stock transport|vendor master|المشتريات|مشتريات|أوامر الشراء|أمر شراء|أمر الشراء|المخزون|استلام البضائع|الموردين/i]),
  def('SD', 'logistics', 'SAP SD', [/\bsd\b|sales orders?|sales and distribution|pricing|condition records?|shipping|outbound deliver|billing documents?|customer invoices?|available-to-promise|\batp\b|variant configuration|المبيعات|مبيعات|أوامر البيع|أمر البيع|التسعير|الشحن/i]),
  def('PP', 'logistics', 'SAP PP', [/\bpp\b|production (?:orders?|planning)|\bmrp\b|shop floor|bills? of materials?|\bbom\b|routings?|manufacturing|pp\/ds|أوامر الإنتاج|تخطيط الإنتاج|التصنيع|الإنتاج/i]),
  def('QM', 'logistics', 'SAP QM', [/\bqm\b|quality (?:management|inspection|notification)|inspection lots?|إدارة الجودة|فحص الجودة/i]),
  def('PM', 'logistics', 'SAP PM', [/(?<!\d\s?)\bPM\b/, /plant maintenance|\beam\b|maintenance orders?|maintenance plan|functional locations?|الصيانة|أوامر الصيانة/i]),
  def('PS', 'logistics', 'SAP PS', [/\bPS\b/, /project system|\bwbs\b|نظام المشاريع/i]),
  def('EWM', 'logistics', 'SAP EWM', [/\bewm\b|extended warehouse|المستودعات/i]),
  def('WM', 'logistics', 'SAP WM', [/\bwm\b|warehouse management|storage bins?|المستودع|مستودع(?! البيانات)/i]),
  def('TM', 'logistics', 'SAP TM', [/\btm\b|transportation management|freight orders?|إدارة النقل/i]),
  def('GTS', 'logistics', 'SAP GTS', [/\bgts\b|global trade|customs/i]),
  def('IBP', 'logistics', 'SAP IBP', [/\bibp\b|integrated business planning|\bapo\b|demand planning/i]),
  def('HCM', 'hcm', 'SAP HCM', [/\bhcm\b|\bhr\b|payroll|personnel administration|time management|organizational management|\bess\b|\bmss\b|الموارد البشرية|الرواتب|رواتب|شؤون الموظفين/i]),
  def('SF', 'hcm', 'SuccessFactors', [/success ?factors|\bsfsf\b|employee central|recruiting|performance and goals|compensation|succession|time off|سكسس ?فاكتورز|الموظف المركزي/i]),
  def('ARIBA', 'procurement', 'SAP Ariba', [/ariba|fieldglass|concur|business network|أريبا/i]),
  def('BASIS', 'technology', 'SAP Basis', [/\bbasis\b|system (?:copy|refresh|administration)|kernel|transport (?:management|requests?)|\bcts\+?\b|\bstms\b|\bupgrade|support packages?|\bspam\b|\bsum\b|\bdmo\b|short dumps?|\bst22\b|installation|backups?|netweaver|work processes|ترقية|النسخ الاحتياطي|إدارة النظام|بيسيس/i]),
  def('HANA', 'technology', 'SAP HANA', [/\bhana\b(?![- ]?cloud)|hana (?:database|db)|قاعدة بيانات هانا|هانا/i], 'product'),
  def('ABAP', 'technology', 'ABAP', [/\babap\b|\bbadis?\b|user exits?|enhancement spots?|custom (?:code|reports?|programs?)|\balv\b|smart ?forms?|adobe forms?|\brap\b|\bcds\b|odata|برمجة|أباب/i]),
  def('FIORI', 'technology', 'SAP Fiori', [/fiori|\bui5\b|sapui5|launchpad|\bflp\b|work ?zone|فيوري/i]),
  def('BTP', 'technology', 'SAP BTP', [/\bbtp\b|business technology platform|\bcap\b|cloud foundry|build apps|process automation|side-by-side|منصة التقنية/i]),
  def('CPI', 'technology', 'SAP Integration', [/\bcpi\b|cloud integration|integration suite|\bpi\/po\b|process orchestration|\bidocs?\b|\bedi\b|api management|event mesh|interfaces?|middleware|التكامل|الربط|واجهات/i]),
  def('SEC', 'technology', 'SAP Security', [/security|authori[sz]ations?|\bpfcg\b|\bgrc\b|access control|single sign-on|\bsso\b|identity management|الصلاحيات|صلاحيات|الأمان/i]),
  def('INFRA', 'technology', 'Infrastructure', [/vmware|vsphere|esxi|virtual machines?|\bvms?\b|servers?|infrastructure|hosting|data cent(?:er|re)|البنية التحتية|خادم|خوادم|استضافة|الأجهزة الافتراضية/i]),
  def('BW', 'analytics', 'SAP BW', [/\bbw\b|bw\/4|business warehouse|datasphere|businessobjects|\bbobj\b|data warehouse|مستودع البيانات/i]),
  def('SAC', 'analytics', 'SAP Analytics Cloud', [/analytics cloud|\bsac\b|dashboards?|لوحات المعلومات/i]),
  def('MDG', 'erp', 'SAP MDG', [/\bmdg\b|master data|business partners?|\bcvi\b|البيانات الرئيسية/i]),
  def('MIGRATION', 'erp', 'Migration', [/migrat|conversion|greenfield|brownfield|data load|lsmw|migration cockpit|نقل البيانات|ترحيل البيانات/i]),
  def('SOLMAN', 'erp', 'Solution Manager', [/solution manager|solman|\bcharm\b|cloud alm/i]),
  def('CX', 'cx', 'SAP CX', [/\bcrm\b|commerce cloud|hybris|sales cloud|service cloud|marketing cloud|emarsys|customer experience/i]),
  def('S4', 'erp', 'SAP S/4HANA', [/s\/?4 ?hana|\bs\/4\b|rise with sap|اس ?فور ?هانا|إس ?4/i], 'product'),
  def('ECC', 'erp', 'SAP ECC', [/\becc\b|\br\/3\b|erp 6/i], 'product'),
];

const MODULE_BY_CODE = new Map(MODULES.map((m) => [m.code, m]));

/** Pairs of modules that are close enough for half credit (and for passing the area filter). */
const RELATED: Array<[string, string]> = [
  ['FI', 'CO'], ['MM', 'ARIBA'], ['HCM', 'SF'], ['EWM', 'WM'], ['BASIS', 'HANA'], ['BASIS', 'INFRA'], ['BASIS', 'SEC'],
  ['BTP', 'CPI'], ['FIORI', 'ABAP'], ['BTP', 'FIORI'], ['S4', 'ECC'], ['S4', 'MIGRATION'], ['BW', 'SAC'], ['MM', 'SD'], ['MM', 'WM'], ['PP', 'QM'],
];
export const related = (a: string, b: string): boolean => a === b || RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** The canonical module codes named by a label or a text ("FI - Accounts Payable (FI-AP)" -> ['FI']). */
export function modulesIn(text: string | null | undefined): string[] {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  return MODULES.filter((m) => m.patterns.some((p) => p.test(s))).map((m) => m.code);
}

// ---------------------------------------------------------------- sub-modules

const SUB_MODULES: Array<[string, RegExp]> = [
  ['FI-GL', /fi-gl|general ledger|universal journal|الأستاذ العام/i],
  ['FI-AP', /fi-ap|accounts? payable|payment run|\bf110\b|vendor invoices?|الذمم الدائنة|المدفوعات/i],
  ['FI-AR', /fi-ar|accounts? receivable|dunning|incoming payments?|الذمم المدينة/i],
  ['FI-AA', /fi-aa|asset accounting|depreciation|fixed assets?|\bafab\b|الأصول الثابتة|الإهلاك/i],
  ['FI-CLOSE', /month[- ]end|year[- ]end|period[- ]end|financial clos|closing cockpit|الإقفال الشهري|إقفال الشهر|الإقفال/i],
  ['FI-TAX', /\bvat\b|withholding|e-?invoic|zatca|fatoora|ضريبة|الفوترة الإلكترونية/i],
  ['CO-PA', /co-pa|profitability analysis|margin analysis/i],
  ['CO-PC', /product costing|cost estimates?|\bck11n\b/i],
  ['MM-PUR', /purchas|purchase orders?|purchase requisitions?|\bme2[1-3]n\b|أوامر الشراء|أمر شراء|المشتريات/i],
  ['MM-IM', /inventory management|goods (?:receipt|issue)|\bmigo\b|stock|المخزون|استلام البضائع/i],
  ['MM-IV', /invoice verification|gr\/ir|\bmiro\b|مطابقة الفواتير/i],
  ['SD-BIL', /billing|\bvf0[1-4]\b|customer invoices?/i],
  ['SD-PR', /pricing|condition records?|التسعير/i],
  ['SF-EC', /employee central|الموظف المركزي/i],
  ['SF-ECP', /employee central payroll/i],
  ['HCM-PY', /payroll|الرواتب|رواتب/i],
  ['BASIS-UPG', /\bupgrade|support packages?|\bspam\b|\bsum\b|ترقية/i],
  ['BASIS-PERF', /performance|tuning|slow|الأداء|بطء/i],
  ['ABAP-EXT', /extension|enhancement|\bbadis?\b|user exits?|key user|تخصيص|توسيع/i],
];
const SUB_PARENT = (sub: string) => sub.split('-')[0];

export function subModulesIn(text: string | null | undefined): string[] {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  return SUB_MODULES.filter(([, re]) => re.test(s)).map(([code]) => code);
}

// ---------------------------------------------------------------- T-codes, error messages, SAP Notes

const TCODE_RULES: Array<[RegExp, string]> = [
  [/^(?:CO0\d|MD0\d|MD\d\d|CS0\d|CR0\d|CA0\d|C20\d|COOIS)$/, 'PP'],
  [/^(?:PP0\d|PA\d\d|PT\d\d|PU\d\d|PC00\w*|PE\d\d|PO1\d)$/, 'HCM'],
  [/^(?:F-?\d{2}|FB\w{1,3}|FS\d\d\w?|FAGL\w*|F110|FBL\dN|OB\w{1,3}|FK\d\d|FD\d\d|AS\d\d|AW01N|AFAB|AJAB|S_ALR_\d+|FTXP)$/, 'FI'],
  [/^(?:KS\d\d|KO\d\d\w?|KE\d\d\w?|KP\d\d|CK\d\dN?|KB\d\dN?|OKB\w+)$/, 'CO'],
  [/^(?:ME\d\dN?|MIGO|MIRO|MB\d\w{0,2}|MM0\d|MMBE|MR\d\w{0,2}|MK\d\d|XK\d\d)$/, 'MM'],
  [/^(?:VA\d\d|VL\d\dN?|VF\d\d|VK\d\d|VD\d\d|XD\d\d)$/, 'SD'],
  [/^(?:IW\d\d|IE\d\d|IL\d\d|IP\d\d)$/, 'PM'],
  [/^(?:QA\d\d|QM\d\d|QE\d\d|QS\d\d)$/, 'QM'],
  [/^(?:CJ\d\d|CN\d\dN?)$/, 'PS'],
  [/^(?:SE\d\d|SMARTFORMS|SFP|SEGW|SAT|SCI)$/, 'ABAP'],
  [/^(?:SM\d\d|ST\d\d\w?|STMS|SPAM|SAINT|SICK|SICF|RZ\d\d|DB\d\d|DBACOCKPIT|AL11|SCC\d|SGEN)$/, 'BASIS'],
  [/^(?:PFCG|SU\d\d|SUIM)$/, 'SEC'],
  [/^\/(?:IWFND|UI2|IWBEP)\/\w+$/, 'FIORI'],
  [/^\/SCWM\/\w+$/, 'EWM'],
  [/^(?:LT\d\d|LS\d\d|LX\d\d)$/, 'WM'],
  [/^(?:WE\d\d|BD\d\d)$/, 'CPI'],
  [/^(?:RSA\d|RSPC|RSRT|RSO2)$/, 'BW'],
];
const TCODE_TOKEN = /\/[A-Z0-9]{2,8}\/[A-Z0-9_]{2,20}|\b(?:S_ALR_\d{8}|[A-Z]{1,4}-?\d{1,3}[A-Z]?|MIGO|MIRO|MMBE|STMS|SPAM|SAINT|PFCG|SUIM|SMARTFORMS|SEGW|DBACOCKPIT|SICF|SGEN|AFAB|AJAB|RSPC|RSRT|COOIS|FTXP|SICK)\b/g;

export function tcodeModule(code: string): string | null {
  const c = code.toUpperCase();
  for (const [re, module] of TCODE_RULES) if (re.test(c)) return module;
  return null;
}

/** T-codes in a text that belong to a known module (other tokens such as "S4" or "WIN10" are ignored). */
export function tcodesIn(text: string): Array<{ code: string; module: string }> {
  const out: Array<{ code: string; module: string }> = [];
  for (const raw of String(text ?? '').toUpperCase().match(TCODE_TOKEN) ?? []) {
    const module = tcodeModule(raw);
    if (module && !out.some((x) => x.code === raw)) out.push({ code: raw, module });
  }
  return out.slice(0, 12);
}

const MESSAGE_CLASS: Record<string, string> = {
  F5: 'FI', FS: 'FI', FB: 'FI', GLT: 'FI', FAGL: 'FI', AA: 'FI', KI: 'CO', KO: 'CO', KE: 'CO', M7: 'MM', M8: 'MM', ME: 'MM', '06': 'MM',
  V1: 'SD', VF: 'SD', VL: 'SD', CO: 'PP', IW: 'PM', PG: 'HCM', '5A': 'HCM', BL: 'ABAP', RSM: 'BW', SY: 'ABAP',
};
/** Messages such as "error F5 702" or "رسالة M7021". */
export function errorCodesIn(text: string): Array<{ code: string; module: string | null }> {
  const out: Array<{ code: string; module: string | null }> = [];
  const re = /(?:message|error|msg|رسالة|خطأ)[^A-Za-z0-9\n]{0,12}(?:no\.?\s*)?([A-Z][A-Z0-9]{1,3}|\d{2})\s?(\d{3})\b/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const cls = m[1].toUpperCase();
    const code = `${cls} ${m[2]}`;
    if (!out.some((x) => x.code === code)) out.push({ code, module: MESSAGE_CLASS[cls] ?? null });
  }
  return out.slice(0, 8);
}

/** SAP Note numbers mentioned in the text ("SAP Note 2270407", "ملاحظة 3012345"). Logged as a count; no data maps notes to modules. */
export function notesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/(?:note|kba|ملاحظة)\s*(?:no\.?|#|number|رقم)?\s*(\d{5,8})\b/gi)) if (!out.includes(m[1])) out.push(m[1]);
  return out.slice(0, 8);
}

// ---------------------------------------------------------------- products, country, deployment

const PRODUCTS: Array<[string, RegExp]> = [
  ['S/4HANA', /s\/?4 ?hana|\bs\/4\b|اس ?فور ?هانا/i], ['ECC', /\becc\b|\br\/3\b/i], ['BTP', /\bbtp\b/i], ['SuccessFactors', /success ?factors|سكسس/i],
  ['Ariba', /ariba|أريبا/i], ['Fiori', /fiori|فيوري/i], ['HANA', /\bhana\b(?![- ]?cloud)/i], ['CPI', /\bcpi\b|integration suite/i],
  ['BW/4HANA', /bw\/4/i], ['Analytics Cloud', /analytics cloud|\bsac\b/i], ['VMware', /vmware|vsphere|esxi/i],
];
export function productsIn(text: string): string[] {
  return PRODUCTS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const COUNTRIES: Array<[string, RegExp]> = [
  ['Saudi Arabia', /saudi|\bksa\b|riyadh|jeddah|dammam|السعودية|الرياض|جدة|الدمام/i],
  ['Egypt', /egypt|cairo|alexandria|مصر|القاهرة|الإسكندرية/i],
  ['United Arab Emirates', /\buae\b|emirates|dubai|abu dhabi|الإمارات|دبي|أبوظبي|أبو ظبي/i],
  ['Qatar', /qatar|doha|قطر|الدوحة/i], ['Kuwait', /kuwait|الكويت/i], ['Bahrain', /bahrain|البحرين/i], ['Oman', /\boman\b|muscat|عمان|مسقط/i],
  ['Jordan', /jordan|amman|الأردن/i], ['Morocco', /morocco|المغرب/i], ['Turkey', /turkey|türkiye|تركيا/i], ['India', /\bindia\b|الهند/i],
  ['Germany', /germany|ألمانيا/i], ['United Kingdom', /\buk\b|united kingdom|britain|بريطانيا/i], ['United States', /\busa\b|united states|أمريكا/i],
];
export function countryIn(text: string): string | null {
  return COUNTRIES.find(([, re]) => re.test(text))?.[0] ?? null;
}

const DEPLOYMENTS: Array<[string, RegExp]> = [
  ['Public cloud (S/4HANA Cloud)', /public (?:cloud|edition)|s\/4 ?hana cloud(?! private)|السحابة العامة/i],
  ['Private cloud (RISE)', /private (?:cloud|edition)|\brise\b|السحابة الخاصة/i],
  ['SAP BTP side-by-side', /side-by-side/i],
  ['On-premise', /on[- ]?prem|on[- ]premise|محلي|داخل الشركة/i],
  ['Hybrid', /\bhybrid\b|هجين/i],
];
export function deploymentIn(text: string): string | null {
  return DEPLOYMENTS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** The roles a ticket needs, from its modules. */
function rolesFor(codes: string[]): string[] {
  const roles = new Set<string>();
  for (const c of codes) {
    if (c === 'ABAP' || c === 'FIORI') roles.add('technical');
    else if (['BASIS', 'SEC', 'HANA', 'INFRA'].includes(c)) roles.add('basis');
    else if (c === 'CPI' || c === 'BTP') roles.add('integration');
    else if (c === 'BW' || c === 'SAC') roles.add('data_analytics');
    else if (MODULE_BY_CODE.get(c)?.kind === 'module' && !['MIGRATION', 'SOLMAN', 'MDG'].includes(c)) roles.add('functional');
  }
  return [...roles];
}

const ARABIC = /[\u0600-\u06FF]/g;
const arabicShare = (s: string) => (s.length ? (s.match(ARABIC)?.length ?? 0) / s.replace(/\s/g, '').length : 0);

// ---------------------------------------------------------------- ticket

export type MatchTicket = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  area_details?: string | null;
  sap_modules?: string[] | null;
  sap_module?: string | null;
  sap_module_other?: string | null;
  sap_notes_tried?: string[] | null;
  urgency?: string | null;
  preferred_language?: string | null;
  industry?: string | null;
  customer_segment?: string | null;
  country?: string | null;
  project_type?: string | null;
  vertical_solutions?: string[] | null;
  localization_solutions?: string[] | null;
  deployment?: string | null;
  work_mode?: string | null;
  /** IANA time zone of the client, e.g. "Asia/Riyadh". */
  timezone?: string | null;
  /** The highest hourly rate the client wants to pay (same currency as the consultants' rates). */
  budget_max_rate?: number | null;
};

export type TicketSignals = {
  /** Module codes from the chosen areas. */
  areaModules: string[];
  /** Module codes found only in the text (not in the chosen areas). */
  textModules: string[];
  modules: string[];
  subModules: string[];
  tcodes: Array<{ code: string; module: string }>;
  errors: Array<{ code: string; module: string | null }>;
  notes: string[];
  products: string[];
  country: string | null;
  deployment: string | null;
  roles: string[];
  language: string | null;
  wordCount: number;
};

export function extractTicketSignals(t: MatchTicket): TicketSignals {
  const areas = [...(t.sap_modules ?? []), t.sap_module ?? '', t.sap_module_other ?? ''].filter(Boolean);
  const text = [t.title, t.description, t.area_details].filter(Boolean).join('\n');
  const areaModules = [...new Set(areas.flatMap(modulesIn))];
  const tcodes = tcodesIn(text);
  const errors = errorCodesIn(text);
  const fromText = [...modulesIn(text), ...tcodes.map((x) => x.module), ...errors.flatMap((x) => (x.module ? [x.module] : []))];
  const textModules = [...new Set(fromText)].filter((c) => !areaModules.includes(c));
  const modules = [...areaModules, ...textModules];
  const subModules = [...new Set([...areas.flatMap(subModulesIn), ...subModulesIn(text)])].filter((s) => modules.some((m) => m === SUB_PARENT(s)));
  const all = `${areas.join(' ')}\n${text}`;
  const pl = String(t.preferred_language ?? '').trim().toLowerCase();
  return {
    areaModules, textModules, modules, subModules, tcodes, errors,
    notes: [...new Set([...(t.sap_notes_tried ?? []), ...notesIn(text)])].slice(0, 8),
    products: productsIn(all),
    country: t.country?.trim() || countryIn(text),
    deployment: (t.deployment?.trim() ? (DEPLOYMENTS.find(([name]) => name === t.deployment!.trim())?.[0] ?? deploymentIn(t.deployment!)) : null) || deploymentIn(all),
    roles: rolesFor(modules),
    language: pl || (arabicShare(text) > 0.3 ? 'ar' : null),
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

/** Clarifying questions for a vague ticket (at most 3). Empty when the ticket is specific enough to match well. */
export type ClarifyKey = 'module' | 'error' | 'country';
export function clarifyingQuestions(t: MatchTicket, s: TicketSignals = extractTicketSignals(t)): ClarifyKey[] {
  const out: ClarifyKey[] = [];
  const functional = s.modules.filter((c) => MODULE_BY_CODE.get(c)?.kind === 'module');
  if (functional.length === 0) out.push('module');
  if (s.wordCount < (functional.length ? 8 : 15) && s.tcodes.length === 0 && s.errors.length === 0) out.push('error');
  if (!s.country && out.length > 0) out.push('country');
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- consultant

export type MatchConsultant = {
  id: string;
  verification_status?: string | null;
  /** False when the account is disabled or suspended. */
  active?: boolean | null;
  availability_status?: string | null;
  skills?: Array<{ module: string; years?: number | null; certified?: boolean | null }> | null;
  certifications?: Array<{ name: string; verified?: boolean | null; expired?: boolean | null }> | null;
  project_modules?: string[] | null;
  technologies?: string[] | null;
  sap_roles?: string[] | null;
  languages?: string[] | null;
  industries?: string[] | null;
  customer_segments?: string[] | null;
  localization_countries?: string[] | null;
  onsite_countries?: string[] | null;
  vertical_solutions?: string[] | null;
  localization_solutions?: string[] | null;
  project_types?: string[] | null;
  deployment_experience?: string[] | null;
  work_modes?: string[] | null;
  timezone?: string | null;
  hourly_rate?: number | null;
  ai_interview_badge?: string | null;
  rating?: number | null;
  total_reviews?: number | null;
  response_time_minutes?: number | null;
  completion_percent?: number | null;
  /** Modules backed by a document an administrator verified. */
  verified_evidence_modules?: string[] | null;
  resolved_in_areas?: number | null;
  solved_similar?: number | null;
  founding?: boolean | null;
};

export type ConsultantModules = { codes: string[]; subs: string[]; years: Map<string, number>; evidence: Set<string> };

export function consultantModules(c: MatchConsultant): ConsultantModules {
  const years = new Map<string, number>();
  const subs = new Set<string>();
  const evidence = new Set<string>();
  const codes = new Set<string>();
  for (const s of c.skills ?? []) {
    for (const code of modulesIn(s.module)) {
      codes.add(code);
      years.set(code, Math.max(years.get(code) ?? 0, Number(s.years) || 0));
    }
    subModulesIn(s.module).forEach((x) => subs.add(x));
  }
  for (const label of [...(c.project_modules ?? []), ...(c.technologies ?? [])]) {
    modulesIn(label).forEach((x) => codes.add(x));
    subModulesIn(label).forEach((x) => subs.add(x));
  }
  for (const cert of c.certifications ?? []) {
    if (cert.expired) continue;
    for (const code of modulesIn(cert.name)) {
      codes.add(code);
      if (cert.verified) evidence.add(code);
    }
  }
  (c.verified_evidence_modules ?? []).flatMap(modulesIn).forEach((x) => evidence.add(x));
  return { codes: [...codes], subs: [...subs], years, evidence };
}

// ---------------------------------------------------------------- weights

export const MATCH_WEIGHT_DEFAULTS = {
  module: 26, sub_module: 6, keywords: 10, experience: 8, role: 4,
  industry: 5, segment: 3, country: 6, deployment: 3, work_mode: 2, timezone: 3, rate: 4,
  badge: 5, rating: 4, response: 3, availability: 3, completion: 2, evidence: 2, founding: 1,
} as const;
export type MatchWeights = Record<keyof typeof MATCH_WEIGHT_DEFAULTS, number>;
export type CriterionKey = keyof typeof MATCH_WEIGHT_DEFAULTS;

/** Reads `platform_settings.match_weights` (JSON). Unknown keys are ignored; every weight is an integer 0..50; a broken value gives the defaults. */
export function readMatchWeights(raw: unknown): MatchWeights {
  let o: unknown = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  const src = (o && typeof o === 'object' && !Array.isArray(o) ? o : {}) as Record<string, unknown>;
  const out = { ...MATCH_WEIGHT_DEFAULTS } as MatchWeights;
  for (const key of Object.keys(out) as CriterionKey[]) {
    const v = Number(src[key]);
    if (src[key] !== undefined && src[key] !== null && src[key] !== '' && Number.isFinite(v)) out[key] = Math.round(Math.min(50, Math.max(0, v)));
  }
  return out;
}

/** FNV-1a 32-bit, hex. Stable, tiny; used for input hashes and the weights version. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const weightsVersion = (w: MatchWeights) => `w1-${fnv1a(JSON.stringify(Object.keys(w).sort().map((k) => [k, w[k as CriterionKey]])))}`;

/** Hash of the inputs that change the ranking (no raw text is stored, only this hash). */
export function matchInputsHash(t: MatchTicket): string {
  const keys: Array<keyof MatchTicket> = ['title', 'description', 'area_details', 'sap_modules', 'sap_module', 'sap_module_other', 'sap_notes_tried', 'urgency', 'preferred_language',
    'industry', 'customer_segment', 'country', 'project_type', 'vertical_solutions', 'localization_solutions', 'deployment', 'work_mode', 'timezone', 'budget_max_rate'];
  return fnv1a(JSON.stringify(keys.map((k) => t[k] ?? null)));
}

// ---------------------------------------------------------------- hard filters

const LANG_NAMES: Record<string, string> = { english: 'en', arabic: 'ar', 'العربية': 'ar', 'الإنجليزية': 'en', german: 'de', french: 'fr', spanish: 'es', hindi: 'hi', urdu: 'ur', turkish: 'tr' };
/** Language codes and names compare as codes ("English" = "en"). */
export const langCode = (l: string | null | undefined): string => { const v = String(l ?? '').trim().toLowerCase(); return LANG_NAMES[v] ?? v; };

export type ExclusionReason = 'not_verified' | 'inactive' | 'excluded' | 'no_area_overlap' | 'language' | 'cannot_respond';

export function hardFilter(c: MatchConsultant, t: MatchTicket, s: TicketSignals, excluded: ReadonlySet<string> = new Set(), cm = consultantModules(c)): ExclusionReason | null {
  if (c.verification_status !== 'verified') return 'not_verified';
  if (c.active === false) return 'inactive';
  if (excluded.has(c.id)) return 'excluded';
  const needed = s.modules.filter((x) => MODULE_BY_CODE.get(x)?.kind === 'module');
  const wanted = needed.length > 0 ? needed : s.modules;
  if (wanted.length > 0) {
    const families = new Set(wanted.map((x) => MODULE_BY_CODE.get(x)?.family));
    // A product the client chose as an area (e.g. "SAP S/4HANA") also counts as overlap; such consultants then rank on the module score.
    const areaProducts = s.areaModules.filter((x) => MODULE_BY_CODE.get(x)?.kind === 'product');
    const overlap = cm.codes.some((have) => wanted.some((w) => related(have, w)) || areaProducts.includes(have)
      || (MODULE_BY_CODE.get(have)?.kind === 'module' && families.has(MODULE_BY_CODE.get(have)?.family)));
    if (!overlap) return 'no_area_overlap';
  }
  const lang = langCode(t.preferred_language);
  if (lang && !(c.languages ?? []).map(langCode).includes(lang)) return 'language';
  if (t.urgency === 'critical' && c.availability_status !== 'available') return 'cannot_respond';
  return null;
}

// ---------------------------------------------------------------- scoring

export type Chip = { key: CriterionKey; text: string };
export type Criterion = { key: CriterionKey; weight: number; fit: number; contribution: number };
export type MatchResult = { consultant_id: string; score: number; breakdown: Criterion[]; chips: Chip[]; coverage: number };

const BADGE_FIT: Record<string, number> = { gold: 1, silver: 0.8, bronze: 0.6, verified: 0.4 };

/** UTC offset in hours of an IANA time zone at a moment (null for an unknown zone). */
export function tzOffsetHours(zone: string | null | undefined, at: Date = new Date(Date.UTC(2026, 0, 15, 12))): number | null {
  if (!zone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return Math.round(((local - at.getTime()) / 3_600_000) * 2) / 2;
  } catch { return null; }
}

const share = (wanted: string[], have: (w: string) => number) => (wanted.length ? wanted.reduce((sum, w) => sum + have(w), 0) / wanted.length : 0);

export function scoreConsultant(c: MatchConsultant, t: MatchTicket, s: TicketSignals, weights: MatchWeights = MATCH_WEIGHT_DEFAULTS, cm = consultantModules(c)): MatchResult {
  const parts: Array<{ key: CriterionKey; fit: number; chip?: string }> = [];
  const moduleFit = (w: string) => (cm.codes.includes(w) ? 1 : cm.codes.some((h) => related(h, w)) ? 0.5 : 0);

  // Modules: the functional/technical modules of the chosen areas count fully (when the areas name none, those found in the text);
  // products (S/4HANA, ECC, HANA) and the other modules named in the text count as keywords below.
  const isModule = (x: string) => MODULE_BY_CODE.get(x)?.kind === 'module';
  const areaFunc = s.areaModules.filter(isModule);
  const primary = areaFunc.length > 0 ? areaFunc : s.textModules.filter(isModule);
  if (primary.length > 0) {
    const hits = primary.filter((w) => cm.codes.includes(w));
    parts.push({ key: 'module', fit: share(primary, moduleFit), chip: hits.length ? hits.map((h) => MODULE_BY_CODE.get(h)?.label ?? h).slice(0, 2).join(', ') : undefined });
  }
  if (s.subModules.length > 0) {
    const hits = s.subModules.filter((x) => cm.subs.includes(x));
    parts.push({ key: 'sub_module', fit: share(s.subModules, (x) => (cm.subs.includes(x) ? 1 : cm.codes.includes(SUB_PARENT(x)) ? 0.4 : 0)), chip: hits[0] });
  }
  // Keywords: T-codes, error messages, products and modules named in the text.
  const keywordItems: Array<{ label: string; module: string | null; product?: string }> = [
    ...s.tcodes.map((x) => ({ label: x.code, module: x.module })),
    ...s.errors.map((x) => ({ label: x.code, module: x.module })),
    ...s.modules.filter((x) => isModule(x) && !primary.includes(x)).map((x) => ({ label: MODULE_BY_CODE.get(x)?.label ?? x, module: x })),
    ...s.products.map((p) => ({ label: p, module: null, product: p })),
  ];
  if (keywordItems.length > 0) {
    const techs = [...(c.technologies ?? []), ...(c.skills ?? []).map((x) => x.module)].join(' ');
    const fit = (k: typeof keywordItems[number]) => (k.module ? moduleFit(k.module) : k.product ? (productsIn(techs).includes(k.product) ? 1 : 0) : 0);
    const hit = keywordItems.find((k) => fit(k) === 1);
    parts.push({ key: 'keywords', fit: share(keywordItems.map((_, i) => String(i)), (i) => fit(keywordItems[Number(i)])), chip: hit?.label });
  }
  if (s.modules.length > 0) {
    const matched = s.modules.filter((m) => cm.codes.includes(m));
    const years = Math.max(0, ...matched.map((m) => cm.years.get(m) ?? 0));
    const solved = Math.min(1, ((c.solved_similar ?? 0) + (c.resolved_in_areas ?? 0)) / 3);
    parts.push({ key: 'experience', fit: 0.7 * Math.min(1, years / 10) + 0.3 * solved, chip: years >= 5 ? `${years}+ yrs` : undefined });
  }
  if (s.roles.length > 0) {
    const have = c.sap_roles ?? [];
    const fit = (r: string) => (have.includes(r) ? 1 : have.includes('techno_functional') && (r === 'functional' || r === 'technical') ? 0.8 : have.includes('architect') ? 0.5 : 0);
    parts.push({ key: 'role', fit: share(s.roles, fit) });
  }
  const ctx = (field: 'industry' | 'customer_segment' | 'country', value: string | null | undefined) => (value ? (contextFit({ [field]: value }, c).score ?? 0) / 100 : null);
  const industry = ctx('industry', t.industry);
  if (industry !== null) parts.push({ key: 'industry', fit: industry, chip: t.industry ?? undefined });
  const segment = ctx('customer_segment', t.customer_segment);
  if (segment !== null) parts.push({ key: 'segment', fit: segment, chip: t.customer_segment ?? undefined });
  if (s.country) {
    const vertical = (t.vertical_solutions ?? []).length || (t.localization_solutions ?? []).length
      ? (contextFit({ vertical_solutions: t.vertical_solutions, localization_solutions: t.localization_solutions }, c).score ?? 0) / 100 : null;
    const country = ctx('country', s.country) ?? 0;
    parts.push({ key: 'country', fit: vertical === null ? country : 0.7 * country + 0.3 * vertical, chip: country >= 0.5 ? s.country : undefined });
  }
  if (s.deployment) parts.push({ key: 'deployment', fit: (c.deployment_experience ?? []).includes(s.deployment) ? 1 : (c.deployment_experience ?? []).includes('Hybrid') ? 0.5 : 0, chip: s.deployment });
  if (t.work_mode) parts.push({ key: 'work_mode', fit: (c.work_modes ?? []).includes(t.work_mode) ? 1 : (c.work_modes ?? []).includes('Hybrid') ? 0.5 : 0, chip: t.work_mode });
  const tTz = tzOffsetHours(t.timezone);
  if (tTz !== null) {
    const cTz = tzOffsetHours(c.timezone);
    const gap = cTz === null ? null : Math.abs(tTz - cTz);
    parts.push({ key: 'timezone', fit: gap === null ? 0.3 : gap <= 2 ? 1 : gap <= 5 ? 0.5 : 0.15, chip: gap !== null && gap <= 2 ? 'overlap' : undefined });
  }
  if (typeof t.budget_max_rate === 'number' && t.budget_max_rate > 0) {
    const rate = Number(c.hourly_rate) || 0;
    parts.push({ key: 'rate', fit: rate <= 0 ? 0.5 : rate <= t.budget_max_rate ? 1 : rate <= t.budget_max_rate * 1.2 ? 0.4 : 0, chip: rate > 0 && rate <= t.budget_max_rate ? 'within' : undefined });
  }
  const badge = String(c.ai_interview_badge ?? '').toLowerCase();
  parts.push({ key: 'badge', fit: BADGE_FIT[badge] ?? 0, chip: BADGE_FIT[badge] >= 0.6 ? badge : undefined });
  const reviews = Math.max(0, c.total_reviews ?? 0);
  const rating = Math.max(0, Math.min(5, Number(c.rating) || 0));
  // Bayesian average: a 5.0 from one review does not beat a 4.8 from forty.
  parts.push({ key: 'rating', fit: reviews > 0 ? ((rating * reviews + 3.5 * 3) / (reviews + 3)) / 5 : 0.4, chip: rating >= 4.5 && reviews >= 3 ? rating.toFixed(1) : undefined });
  const rt = c.response_time_minutes;
  parts.push({ key: 'response', fit: !rt ? 0.3 : rt <= 30 ? 1 : rt <= 60 ? 0.8 : rt <= 240 ? 0.5 : rt <= 1440 ? 0.3 : 0.1, chip: rt && rt <= 30 ? '30' : undefined });
  const status = c.availability_status;
  parts.push({ key: 'availability', fit: status === 'available' ? 1 : status === 'busy' ? 0.5 : 0, chip: status === 'available' ? 'now' : undefined });
  parts.push({ key: 'completion', fit: Math.max(0, Math.min(100, c.completion_percent ?? 0)) / 100 });
  if (s.modules.length > 0) {
    const matched = s.modules.filter((m) => cm.codes.includes(m));
    const backed = matched.filter((m) => cm.evidence.has(m) || (c.resolved_in_areas ?? 0) > 0);
    parts.push({ key: 'evidence', fit: matched.length ? backed.length / matched.length : 0, chip: backed.length ? 'verified' : undefined });
  }
  parts.push({ key: 'founding', fit: c.founding ? 1 : 0 });

  const active = parts.filter((p) => weights[p.key] > 0);
  const total = active.reduce((sum, p) => sum + weights[p.key], 0) || 1;
  const breakdown: Criterion[] = active.map((p) => {
    const weight = Math.round((weights[p.key] * 10000) / total) / 100;
    const fit = Math.round(Math.max(0, Math.min(1, p.fit)) * 100) / 100;
    return { key: p.key, weight, fit, contribution: Math.round(weight * fit * 100) / 100 };
  });
  const chips = active
    .filter((p) => p.chip && p.fit >= 0.5)
    .sort((a, b) => weights[b.key] * b.fit - weights[a.key] * a.fit)
    .filter((p, i, list) => list.findIndex((q) => String(q.chip).toLowerCase() === String(p.chip).toLowerCase()) === i)
    .slice(0, 4)
    .map((p) => ({ key: p.key, text: p.chip as string }));
  const allWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return {
    consultant_id: c.id,
    score: Math.round(breakdown.reduce((sum, b) => sum + b.contribution, 0)),
    breakdown,
    chips,
    coverage: Math.round((100 * total) / allWeight),
  };
}

export type RankOutput = { ranked: MatchResult[]; excluded: Array<{ consultant_id: string; reason: ExclusionReason }>; signals: TicketSignals; questions: ClarifyKey[] };

/** Ranks every eligible consultant (ties: rating, then reviews, then id), then returns them all; callers take the top N. */
export function rankConsultants(t: MatchTicket, consultants: MatchConsultant[], options: { weights?: MatchWeights; excluded?: ReadonlySet<string> } = {}): RankOutput {
  const s = extractTicketSignals(t);
  const weights = options.weights ?? MATCH_WEIGHT_DEFAULTS;
  const excluded: RankOutput['excluded'] = [];
  const ranked: Array<MatchResult & { _c: MatchConsultant }> = [];
  for (const c of consultants) {
    const cm = consultantModules(c);
    const reason = hardFilter(c, t, s, options.excluded, cm);
    if (reason) { excluded.push({ consultant_id: c.id, reason }); continue; }
    ranked.push({ ...scoreConsultant(c, t, s, weights, cm), _c: c });
  }
  ranked.sort((a, b) => b.score - a.score || (Number(b._c.rating) || 0) - (Number(a._c.rating) || 0) || (b._c.total_reviews ?? 0) - (a._c.total_reviews ?? 0) || a.consultant_id.localeCompare(b.consultant_id));
  return { ranked: ranked.map(({ _c, ...r }) => r), excluded, signals: s, questions: clarifyingQuestions(t, s) };
}

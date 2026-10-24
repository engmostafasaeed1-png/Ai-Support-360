// Vocabulary for interview speech-to-text. Pure (no Deno or browser APIs): used by voice-transcribe and tests.
//
// buildVoiceGlossary turns the consultant's profile modules and releases, the current question and the interview
// plan (knowledge base) into keyword hints for the speech model, so "ACDOCA", "BAdI", "Fiori", "S/4HANA 2023" and
// T-codes such as "MIRO" or "FB60" come back spelled correctly. correctTranscript then fixes only the spelling of
// glossary terms that were still heard in another form ("ac doca", "s4 hana", "fb 60"); it never adds, removes or
// reorders words, so the meaning of the answer cannot change. The raw text is kept by the caller for audit.

export interface GlossaryInput {
  /** Profile modules, e.g. "SAP FI", "MM", "FICO", "ABAP". */
  modules?: ReadonlyArray<string | null | undefined>;
  /** Profile releases, e.g. "S/4HANA 2023". */
  versions?: ReadonlyArray<string | null | undefined>;
  /** The interviewer's current question (untrusted text: only SAP-looking tokens are taken from it). */
  question?: string | null;
  /** Interview plan questions and key points (knowledge base), same treatment as the question. */
  planText?: string | null;
  /** Interview language setting, for the prompt. */
  lang?: string | null;
}

export interface VoiceGlossary {
  keywords: string[];
  prompt: string;
}

export const MAX_KEYWORDS = 50;
export const MAX_KEYWORD_LENGTH = 40;
export const MAX_PROMPT_LENGTH = 900;

/** Terms every SAP interview may contain. */
export const SAP_CORE_TERMS: readonly string[] = [
  "SAP", "S/4HANA", "ECC", "Fiori", "SAP GUI", "HANA", "SAP BTP", "RISE with SAP", "ABAP", "CDS view", "BAdI", "BAPI",
  "IDoc", "RFC", "OData", "SPRO", "IMG", "ACDOCA", "Business Partner", "Solution Manager", "SAP Activate", "Universal Journal",
  "Migration Cockpit", "LSMW", "Transport request", "SAPUI5",
];

/** Terms and T-codes per module family (keys after normalizeModule). */
export const MODULE_TERMS: Readonly<Record<string, readonly string[]>> = {
  fi: ["FB60", "FB70", "FB50", "F110", "FBL1N", "FBL3N", "FBL5N", "FS00", "OB52", "F-02", "F-28", "F-53", "FAGLB03", "ACDOCA", "BSEG", "BKPF", "Asset Accounting", "New GL", "Document splitting", "Dunning", "Payment run", "Bank reconciliation"],
  co: ["KS01", "KP06", "KO88", "CK11N", "CK40N", "KE30", "KKS2", "CO-PA", "Profit Center", "Cost Center", "Settlement", "Material Ledger", "Actual costing"],
  mm: ["ME21N", "ME51N", "ME23N", "ME2M", "ME31K", "MIGO", "MIRO", "MM01", "MM02", "MB52", "MMBE", "MR8M", "EKKO", "EKPO", "MARA", "Purchase requisition", "Release strategy", "GR/IR", "Info record", "Source list"],
  sd: ["VA01", "VA02", "VA05", "VL01N", "VL02N", "VF01", "VF04", "VK11", "VBAK", "VBAP", "LIKP", "Pricing procedure", "Condition technique", "Output determination", "ATP", "Credit block"],
  pp: ["CO01", "CO02", "CO11N", "MD01N", "MD04", "CS01", "CR01", "CA01", "MRP Live", "BOM", "Routing", "Work center", "Production version"],
  qm: ["QA01", "QA32", "QE51N", "QM01", "QP01", "Inspection lot", "Usage decision", "Quality notification"],
  pm: ["IW31", "IW32", "IW21", "IE01", "IL01", "IP10", "IP41", "Maintenance plan", "Functional location", "Equipment"],
  ewm: ["/SCWM/MON", "/SCWM/PRDI", "LT01", "LT10", "LS01N", "Warehouse task", "Handling unit", "Storage bin"],
  hcm: ["PA30", "PA40", "PA20", "PU12", "PC00_M99_CALC", "PE01", "Infotype", "Payroll schema", "Personnel area", "Wage type"],
  sf: ["SuccessFactors", "Employee Central", "Employee Central Payroll", "Recruiting", "Onboarding", "Performance & Goals", "Compensation", "Learning", "Provisioning", "Integration Center", "Business rules"],
  abap: ["SE38", "SE80", "SE11", "SE24", "SE37", "SE18", "SE19", "SMARTFORMS", "SFP", "SEGW", "Adobe Forms", "ALV", "BAdI", "BAPI", "CDS view", "AMDP", "RAP", "OData", "ABAP Cloud", "Eclipse ADT", "ABAP Unit", "User exit", "Enhancement spot"],
  basis: ["STMS", "SM37", "SM21", "ST22", "SM50", "SM66", "SU01", "PFCG", "SU53", "ST05", "SPAM", "SUM", "DBACOCKPIT", "RZ10", "SMICM", "Kernel", "Transport Management System"],
  bw: ["RSA1", "BEx", "BW/4HANA", "ADSO", "CompositeProvider", "DTP", "Open ODS view", "Process chain", "Analysis for Office", "Datasphere"],
  ariba: ["Ariba", "Ariba Network", "Guided Buying", "SLP", "Sourcing", "Contract management", "Cloud Integration Gateway"],
  ibp: ["IBP", "Supply planning", "Demand planning", "Excel planning view", "S&OP", "Planning area"],
  tm: ["Freight order", "Freight unit", "Forwarding order", "Charge management"],
  gts: ["GTS", "Compliance management", "Sanctioned party list", "Customs management"],
  grc: ["GRC", "Access Control", "Process Control", "ARA", "EAM", "Firefighter", "SoD"],
  fscm: ["FSCM", "Credit management", "Collections management", "Dispute management", "In-house cash", "Bank Communication Management"],
  ps: ["CJ20N", "CJ40", "CJ88", "WBS element", "Network", "Project Builder"],
  btp: ["SAP BTP", "Integration Suite", "CPI", "Cloud Integration", "SAP Build", "CAP", "Cloud Foundry", "Event Mesh", "Kyma"],
  fiori: ["Fiori", "Fiori launchpad", "Fiori Elements", "SAPUI5", "SAP Gateway", "/IWFND/MAINT_SERVICE", "/UI2/FLP"],
  mdg: ["MDG", "Change request", "BRF+", "Data model"],
  ehs: ["EHS", "Incident management", "Product compliance"],
  isu: ["IS-U", "FI-CA", "Device management", "Billing", "Meter reading"],
  concur: ["Concur", "Expense report", "Travel request"],
};

const MODULE_ALIASES: Readonly<Record<string, string[]>> = {
  fico: ["fi", "co"], fi: ["fi"], co: ["co"], "fi-co": ["fi", "co"], finance: ["fi"], controlling: ["co"],
  mm: ["mm"], sd: ["sd"], pp: ["pp"], qm: ["qm"], pm: ["pm"], eam: ["pm"], wm: ["ewm"], ewm: ["ewm"], le: ["ewm", "sd"],
  hcm: ["hcm"], hr: ["hcm"], payroll: ["hcm"], successfactors: ["sf"], sf: ["sf"], sfsf: ["sf"],
  abap: ["abap"], basis: ["basis"], netweaver: ["basis"], bw: ["bw"], bi: ["bw"], bw4hana: ["bw"], analytics: ["bw"],
  ariba: ["ariba"], ibp: ["ibp"], apo: ["ibp"], tm: ["tm"], gts: ["gts"], grc: ["grc"], security: ["grc", "basis"],
  fscm: ["fscm"], treasury: ["fscm"], ps: ["ps"], btp: ["btp"], cpi: ["btp"], pi: ["btp"], po: ["btp"], integration: ["btp"],
  fiori: ["fiori"], ui5: ["fiori"], mdg: ["mdg"], ehs: ["ehs"], isu: ["isu"], "is-u": ["isu"], utilities: ["isu"], concur: ["concur"],
};

/** Module families for a profile module label ("SAP FI/CO" -> fi, co). Unknown labels give an empty list. */
/** English words SAP consultants say inside Arabic sentences. Used only by the correction pass (never as model hints), so an
 * Arabic-script rendering such as "المابينج" can be written back in Latin script ("mapping") when it clearly sounds alike. */
export const SPOKEN_ENGLISH_TERMS: readonly string[] = [
  "implementation", "configuration", "customizing", "interface", "mapping", "integration", "migration", "upgrade", "go-live", "cutover",
  "testing", "UAT", "master data", "workflow", "report", "change request", "ticket", "deployment", "entries", "posting", "clearing",
  "payment run", "house bank", "purchase order", "purchase requisition", "release strategy", "planned orders", "production orders",
  "routing", "kernel", "dumps", "replication", "payroll", "wage types", "condition type", "pricing procedure", "sales order", "delivery",
  "billing", "invoice", "goods receipt", "cost center", "profit center", "fiscal year", "period", "company code", "plant", "storage location",
  "business partner", "vendor", "customer", "material", "batch", "transport", "authorization", "role", "user exit", "enhancement",
];

/** Terms the correction pass may write: the hint keywords, every term of the consultant's module families, core SAP terms,
 * admin vocabulary and spoken English words. */
export function correctionGlossary(keywords: readonly string[], modules: ReadonlyArray<string | null | undefined> = [], extra: readonly string[] = []): string[] {
  const fams = [...new Set(modules.flatMap((m) => normalizeModule(m)))];
  const all = [...keywords, ...extra, ...fams.flatMap((f) => MODULE_TERMS[f] ?? []), ...SAP_CORE_TERMS, ...SPOKEN_ENGLISH_TERMS];
  const seen = new Set<string>();
  return all.map((t) => sanitizeKeyword(t)).filter((t): t is string => !!t && !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase())).slice(0, 400);
}

export function normalizeModule(label: string | null | undefined): string[] {
  const text = String(label || "").toLowerCase().replace(/\bsap\b/g, " ");
  const out = new Set<string>();
  const whole = text.replace(/[^a-z0-9-]+/g, "");
  for (const fam of MODULE_ALIASES[whole] ?? []) out.add(fam);
  for (const word of text.split(/[^a-z0-9-]+/).filter(Boolean)) {
    for (const fam of MODULE_ALIASES[word] ?? MODULE_ALIASES[word.replace(/-/g, "")] ?? []) out.add(fam);
  }
  return [...out];
}

// Common words that look like codes; never taken from free text.
const NOT_TERMS = new Set([
  "THE", "AND", "FOR", "YOU", "ARE", "WITH", "THIS", "THAT", "WHAT", "HOW", "WHY", "WHEN", "CAN", "YOUR", "HAVE", "FROM",
  "NOT", "BUT", "ALL", "ANY", "ONE", "TWO", "OUR", "WAS", "ITS", "USE", "AN", "OK", "OKAY", "I", "A", "IT", "IS", "IN", "ON",
  "TO", "OF", "OR", "BY", "AS", "AT", "BE", "WE", "DO", "IF", "SO", "NO", "UP", "MY", "ME", "US", "AI", "Q", "KEY",
]);

/** SAP-looking tokens in free text: T-codes (FB60, ME21N, F-02, /SCWM/MON), table names and acronyms (ACDOCA, BAdI). */
export function extractSapTokens(text: string | null | undefined, max = 30): string[] {
  const src = String(text || "").slice(0, 20000);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const k = t.toUpperCase();
    if (t.length < 2 || t.length > MAX_KEYWORD_LENGTH || NOT_TERMS.has(k) || seen.has(k)) return;
    seen.add(k);
    found.push(t);
  };
  const patterns = [
    /\/[A-Z0-9]{2,6}\/[A-Z0-9_]{2,20}/g, // namespaced T-codes
    /\b[A-Z]{1,4}-\d{2}\b/g, // F-02, F-28
    /\b[A-Z]{1,5}\d{1,3}[A-Z]{0,2}\b/g, // FB60, ME21N, CO11N, SE38
    /\bS\/4\s?HANA(?:\s(?:Cloud|20\d\d|1909|1809|1709|1610|1511))?\b/g,
    /\b(?:BAdI|IDoc|OData|SAPUI5|BW\/4HANA|CompositeProvider)\b/g,
    /\b[A-Z]{3,10}\b/g, // ACDOCA, BSEG, BAPI, RAP
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      add(m[0]);
      if (found.length >= max) return found;
    }
  }
  return found;
}

/** A keyword the model accepts: one line, no angle brackets, trimmed and bounded. */
export function sanitizeKeyword(raw: unknown): string | null {
  const t = String(raw ?? "").replace(/[<>\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_KEYWORD_LENGTH) return null;
  return t;
}

const oneLine = (s: string, max: number) => s.replace(/[<>\r\n\t]+/g, " ").replace(/\[\[[^\]]*\]\]/g, " ").replace(/[#*_`~]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Keywords (most specific first) and the context prompt for one recording. */
export function buildVoiceGlossary(input: GlossaryInput): VoiceGlossary {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: unknown) => {
    const k = sanitizeKeyword(t);
    if (!k || seen.has(k.toLowerCase()) || out.length >= MAX_KEYWORDS) return;
    seen.add(k.toLowerCase());
    out.push(k);
  };
  const families = [...new Set((input.modules ?? []).flatMap((m) => normalizeModule(m)))];
  // 1. what the interviewer just asked about, 2. the consultant's releases, 3. their modules' T-codes and terms,
  // 4. the interview plan (knowledge base), 5. general SAP terms.
  extractSapTokens(input.question, 15).forEach(add);
  (input.versions ?? []).forEach(add);
  const perFamily = families.length ? Math.max(4, Math.floor(26 / families.length)) : 0;
  for (const fam of families) (MODULE_TERMS[fam] ?? []).slice(0, perFamily).forEach(add);
  extractSapTokens(input.planText, 20).forEach(add);
  SAP_CORE_TERMS.forEach(add);

  const moduleText = (input.modules ?? []).map((m) => oneLine(String(m || ""), 30)).filter(Boolean).slice(0, 6).join(", ");
  const versionText = (input.versions ?? []).map((v) => oneLine(String(v || ""), 40)).filter(Boolean).slice(0, 4).join(", ");
  const question = oneLine(String(input.question || ""), 260);
  const parts = [
    `Spoken answer in a job interview for an SAP consultant${moduleText ? ` (modules: ${moduleText}${versionText ? `; releases: ${versionText}` : ""})` : ""}.`,
    "The speaker may mix English and Arabic (Egyptian, Gulf or Levantine dialect) in one answer, and may have an Indian, British or Arabic accent.",
    "Write Arabic words in Arabic script and English words, SAP terms and transaction codes in Latin script, exactly as spoken.",
    "Write all numbers, years, amounts, movement types and transaction codes with the digits 0-9.",
    question ? `The interviewer asked: "${question}"` : "",
  ].filter(Boolean);
  return { keywords: out, prompt: parts.join(" ").slice(0, MAX_PROMPT_LENGTH) };
}

// ---------------------------------------------------------------------------------------------------------------
// Post-correction
// ---------------------------------------------------------------------------------------------------------------

export interface Correction { from: string; to: string }

// Proper names that are written with one capital only; other terms are case-fixed only when their spelling is technical.
const PROPER_NAMES = new Set(["fiori", "ariba", "successfactors", "concur", "datasphere", "kyma", "signavio", "fieldglass"]);
// Lower-case forms that are ordinary English words; never re-cased.
const PLAIN_WORDS = new Set(["network", "settlement", "routing", "billing", "learning", "recruiting", "onboarding", "compensation", "sourcing", "equipment", "kernel", "sum", "rap", "cap", "sod", "ara", "img", "bom", "ale", "spam"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isTechnical = (term: string) => /[A-Z].*[A-Z]|\d|\//.test(term.slice(1)) || /^[A-Z]{2,}$/.test(term) || PROPER_NAMES.has(term.toLowerCase());

/** Fixed misspellings that speech models commonly produce for SAP names. */
const ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/\bS\s*\/?\s*(?:4|four)\s*\/?\s*hana\b/gi, "S/4HANA"],
  [/\bS\s*\/\s*4\b(?=\s+20\d\d\b)/gi, "S/4HANA"],
  [/\bBW\s*\/?\s*(?:4|four)\s*\/?\s*hana\b/gi, "BW/4HANA"],
  [/\bbad\s?I\b(?=\s+(?:implementation|definition|enhancement|for|to|in)\b)/gi, "BAdI"],
  [/\bbadi\b/gi, "BAdI"],
  [/\bi\s?doc(s?)\b/gi, "IDoc$1"],
  [/\bo\s?data\b/gi, "OData"],
  [/\bsap\s?ui\s?5\b/gi, "SAPUI5"],
];

/**
 * Fixes how glossary terms are written, without changing the meaning: only the spelling, case or spacing of a term that
 * is already there changes ("ac doca" -> "ACDOCA", "fb 60" -> "FB60", "s4 hana 2023" -> "S/4HANA 2023"). Arabic text,
 * word order and every other word stay exactly as transcribed.
 */
export function correctTranscript(text: string, glossary: ReadonlyArray<string>): { text: string; changes: Correction[] } {
  let out = String(text || "");
  const changes: Correction[] = [];
  const apply = (re: RegExp, to: string | ((m: string, ...g: string[]) => string)) => {
    out = out.replace(re, (m: string, ...rest: unknown[]) => {
      const groups = rest.filter((x) => typeof x === "string") as string[];
      const next = typeof to === "function" ? to(m, ...groups) : to.replace("$1", groups[0] ?? "");
      if (next !== m) changes.push({ from: m, to: next });
      return next;
    });
  };
  for (const [re, to] of ALIASES) apply(new RegExp(re.source, re.flags), to);
  const terms = [...new Set(glossary)].filter((t) => isTechnical(t) && !PLAIN_WORDS.has(t.toLowerCase())).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const compact = term.replace(/\s+/g, "");
    const hasDigit = /\d/.test(compact);
    const chars = [...compact].map(escapeRe);
    // T-codes and long codes may be heard with spaces or dots between their parts ("f b 60", "me 21 n", "ac doca").
    const spaced = (hasDigit && compact.length <= 10) || (/^[A-Z]{6,}$/.test(compact));
    const body = spaced ? chars.join("[\\s.-]?") : term.split(/\s+/).map(escapeRe).join("\\s+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}/_-])${body}(?![\\p{L}\\p{N}/_])`, "giu");
    apply(re, (m) => (m === term ? m : term));
  }
  return { text: out, changes: changes.filter((c) => c.from !== c.to) };
}

// ---------------------------------------------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------------------------------------------

/** "en", "ar", "mixed" or another ISO code, from the model's detected languages and the script of the text. */
export function detectLanguage(text: string, modelLanguages?: ReadonlyArray<{ code?: string } | string> | null): string | null {
  const codes = [...new Set((modelLanguages ?? []).map((l) => (typeof l === "string" ? l : l?.code || "")).map((c) => c.toLowerCase().split(/[-_]/)[0]).filter((c) => /^[a-z]{2}$/.test(c)))];
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length;
  const total = arabic + latin;
  if (codes.length > 1) return "mixed";
  if (total === 0) return codes[0] ?? null;
  const ar = arabic / total;
  if (ar >= 0.15 && ar <= 0.85) return "mixed";
  if (ar > 0.85) return "ar";
  return codes[0] && codes[0] !== "ar" ? codes[0] : "en";
}

// Release / version choices per SAP product family, for the optional "version / release" value of each profile module.
// Admins can replace a family's list (table sap_version_options, docs/sql/interview-knowledge.sql); these defaults are
// used for families without admin rows. Consultants can always type their own value instead.
// Pure (no Deno or browser APIs): used by the profile editor, the admin page and tests.

export interface VersionFamily {
  key: string;
  label: string;
  versions: string[];
}

export const MAX_VERSION_LENGTH = 60;

export const DEFAULT_VERSION_FAMILIES: VersionFamily[] = [
  { key: "s4hana", label: "S/4HANA", versions: ["S/4HANA 2025", "S/4HANA 2023", "S/4HANA 2022", "S/4HANA 2021", "S/4HANA 2020", "S/4HANA 1909 or older", "S/4HANA Cloud Public Edition", "S/4HANA Cloud Private Edition (RISE)"] },
  { key: "ecc", label: "ECC / R/3", versions: ["ECC 6.0 EHP8", "ECC 6.0 EHP7", "ECC 6.0 EHP6 or older", "R/3 4.7 or older"] },
  { key: "successfactors", label: "SuccessFactors", versions: ["1H 2025", "2H 2024", "1H 2024", "2H 2023", "Older release"] },
  { key: "btp", label: "BTP / integration", versions: ["BTP Cloud Foundry", "BTP Kyma", "BTP Neo (legacy)", "Integration Suite (CPI)", "PI/PO 7.5", "PI/PO 7.4 or older"] },
  { key: "fiori", label: "Fiori / UI5", versions: ["Fiori launchpad on S/4HANA 2023+", "Fiori launchpad on S/4HANA 2020-2022", "Fiori on ECC (front-end server)", "SAPUI5 1.120+", "SAPUI5 1.108 or older"] },
  { key: "abap", label: "ABAP", versions: ["ABAP Cloud / RAP", "ABAP 7.5x", "ABAP 7.4", "ABAP 7.3 or older"] },
  { key: "basis", label: "Basis / NetWeaver", versions: ["NetWeaver 7.5", "NetWeaver 7.4", "ABAP Platform 2023", "ABAP Platform 2022 or older", "HANA 2.0 SPS07+", "HANA 2.0 SPS06 or older"] },
  { key: "bw", label: "BW / analytics", versions: ["BW/4HANA 2023", "BW/4HANA 2021", "BW 7.5 on HANA", "BW 7.4 or older", "Datasphere", "SAC (current cloud release)"] },
  { key: "ariba", label: "Ariba", versions: ["Ariba cloud (current release)", "Ariba with S/4HANA integration", "Ariba with ECC integration"] },
  { key: "other", label: "Other SAP products", versions: ["Current cloud release", "On-premise, latest release", "On-premise, older release"] },
];

const RULES: Array<[RegExp, string]> = [
  [/success\s*factors|employee central|\bsf\b|sfsf/i, "successfactors"],
  [/ariba|business network/i, "ariba"],
  [/\bbtp\b|integration suite|\bcpi\b|pi\/po|cloud connector|\bcap\b|kyma/i, "btp"],
  [/fiori|ui5/i, "fiori"],
  [/\babap\b|\brap\b/i, "abap"],
  [/basis|netweaver|hana db|\bhana\b(?!.*s\/4)|solution manager|transport|system copy|upgrade|patch/i, "basis"],
  [/\bbw\b|bw\/4|datasphere|analytics cloud|\bsac\b/i, "bw"],
  [/\becc\b|r\/3/i, "ecc"],
  [/s\/?4|\bfi\b|\bco\b|\bmm\b|\bsd\b|\bpp\b|\bpm\b|\bqm\b|\bps\b|\bwm\b|ewm|\btm\b|eam|finance|controlling|procurement|logistics|material|treasury|costing|billing|pricing|batch|variant configuration|business partner|migration|intercompany|subcontracting|\batp\b|mrp/i, "s4hana"],
];

/** The product family of a profile module, used to pick the release list. */
export function versionFamily(module: string): string {
  const s = String(module || "");
  for (const [re, key] of RULES) if (re.test(s)) return key;
  return "other";
}

/** Release choices for a module: admin rows for its family when there are any, otherwise the defaults. */
export function versionChoices(module: string, adminRows: ReadonlyArray<{ module_key: string; label: string; is_active?: boolean; sort_order?: number }> = []): string[] {
  const fam = versionFamily(module);
  const rows = adminRows.filter((r) => r.module_key === fam && r.is_active !== false);
  if (rows.length) return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label)).map((r) => r.label);
  return DEFAULT_VERSION_FAMILIES.find((f) => f.key === fam)?.versions ?? DEFAULT_VERSION_FAMILIES[DEFAULT_VERSION_FAMILIES.length - 1].versions;
}

/** Trimmed, bounded version text, or null for "not set". */
export function cleanVersion(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/[<>[\]{}]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_VERSION_LENGTH) : "";
  return s || null;
}

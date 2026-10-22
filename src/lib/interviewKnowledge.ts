// Browser side of the knowledge-based AI interview (admin Training page, profile editor, consultant notice).
// The rules themselves live in supabase/functions/_shared (shared with the server functions and tested with vitest).
export {
  ACCEPT_ATTRIBUTE as KNOWLEDGE_ACCEPT,
  DEFAULT_KNOWLEDGE_SETTINGS,
  DOCUMENT_LANGUAGES,
  KNOWLEDGE_SETTINGS_KEY,
  MAX_DOCUMENT_BYTES,
  normalizeKnowledgeSettings,
  safeFileName,
  type KnowledgeSettings,
} from '../../supabase/functions/_shared/knowledgeDocs.ts';
export { hasPersonalData, scanPersonalData, type PiiFindings } from '../../supabase/functions/_shared/untrustedText.ts';
export { cleanVersion, DEFAULT_VERSION_FAMILIES, MAX_VERSION_LENGTH, versionChoices, versionFamily } from '../../supabase/functions/_shared/sapVersions.ts';
export { planLabel } from '../../supabase/functions/_shared/interviewPlan.ts';

export type DocumentStatus = 'uploaded' | 'extracting' | 'ready' | 'no_text' | 'failed';

export interface KnowledgeDocument {
  id: string;
  title: string;
  sap_module: string;
  sap_version: string | null;
  language: string;
  tags: string[];
  enabled: boolean;
  notes: string | null;
  file_name: string;
  file_kind: 'pdf' | 'docx' | 'txt' | 'md';
  size_bytes: number;
  status: DocumentStatus;
  status_reason: string | null;
  chunk_count: number;
  pii_flags: { emails?: number; phones?: number; longNumbers?: number } | null;
  uploaded_by: string;
  rights_confirmed_at: string;
  created_at: string;
}

export interface CoverageRow {
  sap_module: string;
  sap_version: string | null;
  documents: number;
  module_documents: number;
  chunks: number;
  consultants: number;
  questions_asked: number;
  avg_score: number | null;
}

/** "The table/function does not exist yet" = the prepared SQL file is not applied. */
export function isNotAppliedError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883' || code === '42703'
    || /does not exist|could not find the (table|function)|schema cache/i.test(String(error.message ?? ''));
}

/** Upload-time check in the browser (the server repeats it by content): extension allowlist and size. */
export function precheckFile(file: { name: string; size: number }): 'ok' | 'too_large' | 'wrong_type' | 'empty' {
  if (file.size <= 0) return 'empty';
  if (file.size > 10 * 1024 * 1024) return 'too_large';
  return /\.(pdf|docx|txt|md)$/i.test(file.name) ? 'ok' : 'wrong_type';
}

/** Comma/semicolon separated tags, trimmed, unique, at most 20 of at most 40 characters. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text || '').split(/[,;\n]/)) {
    const t = raw.replace(/[<>[\]{}]/g, '').trim().slice(0, 40);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 20);
}

/** Coverage hint for one row: none, only release-independent documents, or covered. */
export function coverageState(row: Pick<CoverageRow, 'documents' | 'module_documents'>): 'none' | 'general_only' | 'covered' {
  if (row.documents > 0) return 'covered';
  return row.module_documents > 0 ? 'general_only' : 'none';
}

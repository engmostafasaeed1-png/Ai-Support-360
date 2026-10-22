import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  isNotAppliedError, KNOWLEDGE_SETTINGS_KEY, normalizeKnowledgeSettings,
  type CoverageRow, type KnowledgeDocument, type KnowledgeSettings,
} from '@/lib/interviewKnowledge';

// The tables come with docs/sql/interview-knowledge.sql (prepared, applied by the owner). Until then every query here
// answers "not applied" instead of failing, and the Training page shows a short notice.
const db = supabase as any;
const FN = 'interview-knowledge';

export function useKnowledgeReady() {
  return useQuery({
    queryKey: ['ik', 'ready'],
    staleTime: 60_000,
    queryFn: async () => {
      // a normal read (not a HEAD request): a HEAD request on a missing table comes back without an error
      const { error, status } = await db.from('interview_knowledge_documents').select('id').limit(1);
      if (status === 404) return false;
      if (error && isNotAppliedError(error)) return false;
      if (error) throw error;
      return true;
    },
  });
}

export function useKnowledgeDocuments(enabled: boolean) {
  return useQuery({
    queryKey: ['ik', 'documents'],
    enabled,
    queryFn: async (): Promise<KnowledgeDocument[]> => {
      const { data, error } = await db
        .from('interview_knowledge_documents')
        .select('id, title, sap_module, sap_version, language, tags, enabled, notes, file_name, file_kind, size_bytes, status, status_reason, chunk_count, pii_flags, uploaded_by, rights_confirmed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as KnowledgeDocument[];
    },
    // keep polling while a document is still being read
    refetchInterval: (q) => ((q.state.data as KnowledgeDocument[] | undefined)?.some((d) => d.status === 'uploaded' || d.status === 'extracting') ? 4000 : false),
  });
}

export function useDocumentExcerpts(documentId: string | null) {
  return useQuery({
    queryKey: ['ik', 'excerpts', documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await db.from('interview_knowledge_chunks').select('id, chunk_no, body').eq('document_id', documentId).order('chunk_no').limit(3);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; chunk_no: number; body: string }>;
    },
  });
}

export function useKnowledgeSettings() {
  return useQuery({
    queryKey: ['ik', 'settings'],
    queryFn: async (): Promise<KnowledgeSettings> => {
      const { data, error } = await supabase.from('platform_settings').select('value').eq('key', KNOWLEDGE_SETTINGS_KEY).maybeSingle();
      if (error) throw error;
      return normalizeKnowledgeSettings(data?.value);
    },
  });
}

export function useSaveKnowledgeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: KnowledgeSettings) => {
      const value = normalizeKnowledgeSettings(next);
      const { data: existing, error: readError } = await supabase.from('platform_settings').select('id').eq('key', KNOWLEDGE_SETTINGS_KEY).maybeSingle();
      if (readError) throw readError;
      const { error } = existing
        ? await supabase.from('platform_settings').update({ value: value as any, updated_at: new Date().toISOString() }).eq('id', existing.id)
        : await supabase.from('platform_settings').insert({ key: KNOWLEDGE_SETTINGS_KEY, value: value as any });
      if (error) throw error;
      return value;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ik', 'settings'] }),
  });
}

export function useCoverage(enabled: boolean, days = 30) {
  return useQuery({
    queryKey: ['ik', 'coverage', days],
    enabled,
    queryFn: async (): Promise<CoverageRow[]> => {
      const { data, error } = await db.rpc('ik_coverage', { _days: days });
      if (error) throw error;
      return (data ?? []) as CoverageRow[];
    },
  });
}

export function useVersionOptions() {
  return useQuery({
    queryKey: ['ik', 'version-options'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from('sap_version_options').select('id, module_key, label, sort_order, is_active').order('sort_order');
      if (error) return [] as Array<{ id: string; module_key: string; label: string; sort_order: number; is_active: boolean }>;
      return data ?? [];
    },
  });
}

/** Typed errors from the function: `message` is readable, `code` lets the screen translate. */
export class KnowledgeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function readFunctionError(error: any, data: any): Promise<KnowledgeError> {
  let body = data;
  try { if (!body && error?.context?.json) body = await error.context.json(); } catch { /* not JSON */ }
  return new KnowledgeError(String(body?.error ?? 'failed'), String(body?.message ?? error?.message ?? 'Something went wrong.'));
}

export async function callKnowledge<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error || data?.error) throw await readFunctionError(error, data);
  return data as T;
}

export async function uploadKnowledgeDocument(file: File, meta: Record<string, unknown>) {
  const form = new FormData();
  form.append('file', file);
  form.append('meta', JSON.stringify(meta));
  const { data, error } = await supabase.functions.invoke(FN, { body: form });
  if (error || data?.error) throw await readFunctionError(error, data);
  return data as { document_id: string; status: string; chunks?: number; pii?: { emails: number; phones: number; longNumbers: number } };
}

/** For the consultant's pre-interview line: is the feature on? (false before the SQL file is applied) */
export function useKnowledgeEnabledForMe(active: boolean) {
  return useQuery({
    queryKey: ['ik', 'public-enabled'],
    enabled: active,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc('ik_public_enabled');
      if (error) return false;
      return data === true;
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const db = supabase as any;

export type KnowledgeStatus = 'draft' | 'published' | 'archived';

export interface KnowledgeItem {
  id: string;
  title: string;
  problem_description: string | null;
  solution: string | null;
  sap_module: string | null;
  sap_modules: string[];
  tags: string[];
  status: KnowledgeStatus;
  helpful_count: number | null;
  created_at: string;
  origin_kind: 'session' | 'ticket' | 'manual' | null;
  privacy_flags: string[];
  reviewed_at: string | null;
}

/** The knowledge items of one status (administrators see all of them), with where each one came from. */
export function useKnowledgeItems(status: KnowledgeStatus) {
  return useQuery({
    queryKey: ['knowledge-review', 'items', status],
    queryFn: async (): Promise<KnowledgeItem[]> => {
      const { data, error } = await db.from('knowledge_solutions')
        .select('id, title, problem_description, solution, sap_module, sap_modules, tags, status, helpful_count, created_at')
        .eq('status', status).order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      const rows: any[] = data ?? [];
      const ids = rows.map(r => r.id);
      let metas: any[] = [];
      if (ids.length > 0) {
        const { data: m } = await db.from('knowledge_solution_meta')
          .select('solution_id, origin_kind, privacy_flags, reviewed_at').in('solution_id', ids);
        metas = m ?? [];
      }
      return rows.map(r => {
        const meta = metas.find(x => x.solution_id === r.id);
        return {
          ...r,
          sap_modules: r.sap_modules ?? [],
          tags: r.tags ?? [],
          origin_kind: meta?.origin_kind ?? null,
          privacy_flags: meta?.privacy_flags ?? [],
          reviewed_at: meta?.reviewed_at ?? null,
        } as KnowledgeItem;
      });
    },
  });
}

export function useKnowledgeCounts() {
  return useQuery({
    queryKey: ['knowledge-review', 'counts'],
    queryFn: async (): Promise<Record<KnowledgeStatus, number>> => {
      const out: Record<KnowledgeStatus, number> = { draft: 0, published: 0, archived: 0 };
      for (const s of Object.keys(out) as KnowledgeStatus[]) {
        const { count } = await db.from('knowledge_solutions').select('id', { count: 'exact', head: true }).eq('status', s);
        out[s] = count ?? 0;
      }
      return out;
    },
  });
}

export interface KnowledgePatch {
  title?: string;
  problem_description?: string;
  solution?: string;
  tags?: string[];
  status?: KnowledgeStatus;
}

export function useUpdateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; patch: KnowledgePatch }) => {
      const { error } = await db.from('knowledge_solutions').update(v.patch).eq('id', v.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-review'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save'),
  });
}

export type AiSwitchKey = 'ai_suggestions_enabled' | 'ai_learning_enabled';

/** The two administrator switches. A missing row means "on". */
export function useAiSwitches() {
  return useQuery({
    queryKey: ['knowledge-review', 'switches'],
    queryFn: async (): Promise<Record<AiSwitchKey, boolean>> => {
      const { data, error } = await db.from('platform_settings').select('key, value').in('key', ['ai_suggestions_enabled', 'ai_learning_enabled']);
      if (error) throw new Error(error.message);
      const out: Record<AiSwitchKey, boolean> = { ai_suggestions_enabled: true, ai_learning_enabled: true };
      for (const r of (data ?? []) as Array<{ key: AiSwitchKey; value: unknown }>) {
        if (typeof r.value === 'boolean') out[r.key] = r.value;
      }
      return out;
    },
  });
}

export function useSetAiSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: AiSwitchKey; value: boolean }) => {
      const { error } = await db.from('platform_settings').upsert({ key: v.key, value: v.value }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-review', 'switches'] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save'),
  });
}

export interface LearnSummary {
  enabled: boolean;
  created: number;
  looked_at: number;
  stopped?: string;
  results: Array<{ ticket_id: string; outcome: 'created' | 'skipped' | 'error'; reason?: string; flags?: string[] }>;
}

/** Asks the server to turn up to 5 finished tickets into anonymised drafts. */
export function useLearnFromTickets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<LearnSummary> => {
      const { data, error } = await supabase.functions.invoke('ai-learn-from-ticket', { body: { batch: true, limit: 5 } });
      if (error || data?.error) throw new Error(String(data?.error || error?.message || 'Could not learn from the tickets'));
      return data as LearnSummary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-review'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

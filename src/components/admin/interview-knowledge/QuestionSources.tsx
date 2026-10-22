import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export interface QuestionSourceRow {
  question_order: number;
  question_source: {
    type?: string; module?: string | null; version?: string | null; plan_question?: number;
    document_ids?: string[]; chunk_ids?: string[]; library_ids?: string[]; knowledge_ids?: string[];
  } | null;
}

/** Why each question of an interview was asked (admins only; null before the prepared SQL is applied). */
export function useQuestionSources(interviewId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['ik', 'question-sources', interviewId],
    enabled: enabled && !!interviewId,
    queryFn: async () => {
      const db = supabase as any;
      const { data, error } = await db.rpc('admin_interview_question_sources', { _interview_id: interviewId });
      if (error) return null;
      const rows = (data ?? []) as QuestionSourceRow[];
      const docIds = [...new Set(rows.flatMap((r) => r.question_source?.document_ids ?? []))];
      const { data: docs } = docIds.length ? await db.from('interview_knowledge_documents').select('id, title').in('id', docIds) : { data: [] };
      const titles = new Map<string, string>((docs ?? []).map((d: any) => [d.id, d.title]));
      return { byOrder: new Map(rows.map((r) => [r.question_order, r.question_source])), titles };
    },
  });
}

export function QuestionSourceLine({ source, titles }: { source: QuestionSourceRow['question_source'] | undefined; titles: Map<string, string> }) {
  const { t } = useTranslation();
  if (!source?.type) return null;
  const docs = (source.document_ids ?? []).map((id) => titles.get(id) ?? t('ik.sources.deleted_doc', 'deleted document')).join(', ');
  const what = source.type === 'document' ? `${t('ik.source.document', 'Knowledge document')}: ${docs}`
    : t(`ik.source.${source.type}`, source.type);
  const where = [source.module, source.version].filter(Boolean).join(' · ');
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
      <span>{t('ik.sources.why', 'Why asked (admins only)')}: {what}{where ? ` (${where})` : ''}</span>
    </p>
  );
}

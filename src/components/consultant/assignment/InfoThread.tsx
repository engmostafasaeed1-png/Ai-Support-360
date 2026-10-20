import { useTranslation } from 'react-i18next';
import { Lock, MessageCircleQuestion } from 'lucide-react';
import type { InfoRequestRow } from '@/hooks/useAssignmentInfo';
import { fileTypeLabel } from '../../../../supabase/functions/_shared/assignmentInfo';

const TOPIC_FALLBACK: Record<string, string> = {
  scope: 'Scope', system: 'System version / landscape', error: 'Error message / screenshot', timeline_budget: 'Timeline / budget', access: 'Access method',
};

/** The consultant's questions and the client's answers on one assignment request (attachments named, never opened). */
export default function InfoThread({ rows }: { rows: InfoRequestRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <ol className="mt-2 space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-border/50 bg-muted/30 p-2.5 text-xs">
          <p className="flex items-center gap-1 font-medium text-foreground">
            <MessageCircleQuestion className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {t('assignment_info.you_asked', 'You asked')}
          </p>
          {(r.topics ?? []).length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {(r.topics ?? []).map((k) => (
                <span key={k} className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{t(`assignment_info.topic_${k}`, TOPIC_FALLBACK[k] ?? k)}</span>
              ))}
            </p>
          )}
          {r.question && <p className="mt-1 whitespace-pre-wrap text-muted-foreground" dir="auto">{r.question}</p>}
          {r.status === 'answered' && r.answer && (
            <div className="mt-2 border-s-2 border-primary/50 ps-2">
              <p className="font-medium text-foreground">{t('assignment_info.client_answered', 'Client answered')}</p>
              <p className="whitespace-pre-wrap text-foreground" dir="auto">{r.answer}</p>
              {r.attachment_name && (
                <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {t('assignment_info.answer_file', 'Attached file: {{name}} ({{type}}), unlocks after engagement', { name: r.attachment_name, type: fileTypeLabel(r.attachment_name, r.attachment_type) })}
                </p>
              )}
            </div>
          )}
          {r.status === 'open' && <p className="mt-1 text-amber-700 dark:text-amber-400">{t('assignment_info.paused_consultant', "Waiting for the client's answer · reply clock paused")}</p>}
          {r.status === 'timed_out' && <p className="mt-1 text-muted-foreground">{t('assignment_info.overdue_consultant', 'The client has not answered yet. This request is not counted against you; you can still accept or decline.')}</p>}
        </li>
      ))}
    </ol>
  );
}

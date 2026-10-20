import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Lock, Paperclip, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDecisionPreview } from '@/hooks/useAssignmentInfo';
import { timeLeftLabel } from '../../../../supabase/functions/_shared/assignmentPolicy';

interface Props {
  requestId: string | null;
  onClose: () => void;
  /** Accept / Decline / Request more information, shown under the preview. */
  actions?: ReactNode;
}

const sizeLabel = (n: number | null) => (n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "Open ticket description": what the consultant may read before deciding. Locked items are named, never shown. */
export default function DecisionPreviewDialog({ requestId, onClose, actions }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data: p, isLoading, isError } = useDecisionPreview(requestId);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar' : undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);

  const facts: Array<[string, string]> = [];
  if (p) {
    const area = [p.sap_module, ...p.sap_modules.filter((m) => m !== p.sap_module)].filter(Boolean).join(', ');
    if (area) facts.push([t('assignment_info.area', 'SAP area'), area]);
    if (p.sap_module_other) facts.push([t('assignment_info.module_other', 'Other module'), p.sap_module_other]);
    if (p.area_details) facts.push([t('assignment_info.area_details', 'Sub-module / details'), p.area_details]);
    if (p.industry) facts.push([t('assignment_info.industry', 'Industry'), p.industry]);
    if (p.country) facts.push([t('assignment_info.country', 'Country / region'), p.country]);
    if (p.planned_hours != null) facts.push([t('assignment_info.hours', 'Expected hours'), String(p.planned_hours)]);
    if (p.planned_cost != null) facts.push([t('assignment_info.budget', 'Budget'), `${p.planned_cost} ${p.cost_currency || 'USD'}`]);
    if (p.budget_max_rate != null) facts.push([t('assignment_info.budget_rate', 'Budget (max. hourly rate)'), `${p.budget_max_rate} ${p.cost_currency || 'USD'} ${t('assignment_info.per_hour', '/ hour')}`]);
    if (p.proposed_rate != null && p.proposed_rate > 0) facts.push([t('assignment_info.rate', 'Proposed rate'), `${p.proposed_rate} ${p.rate_currency || 'USD'} ${t('assignment_info.per_hour', '/ hour')}`]);
    const due = when(p.response_due_at);
    if (due && !p.info_paused) facts.push([t('assignment_info.reply_by', 'Reply by'), `${due} · ${timeLeftLabel(Date.parse(p.response_due_at as string), Date.now(), lang)}`]);
    const bid = when(p.bid_deadline);
    if (bid) facts.push([t('assignment_info.bid_deadline', 'Bid deadline'), bid]);
  }

  return (
    <Dialog open={!!requestId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('assignment_info.preview_title', 'Ticket description')}
          </DialogTitle>
          <DialogDescription className="text-start">
            {t('assignment_info.preview_subtitle', 'Read before deciding. Opening it is not an answer and the reply clock keeps running. The client sees that you viewed it.')}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3" aria-busy="true" aria-label={t('assignment_info.loading', 'Loading…')}>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {isError && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {t('assignment_info.preview_failed', 'The ticket description could not be loaded. Please try again.')}
          </p>
        )}

        {p && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="me-auto text-base font-semibold text-foreground">{p.title}</h3>
              <Badge variant="secondary" className={p.critical ? 'bg-destructive/10 text-destructive' : 'capitalize'}>
                {p.critical && <Zap className="me-1 h-3 w-3" aria-hidden="true" />}
                {p.critical ? t('assignment_info.critical', 'Critical') : p.urgency}
              </Badge>
            </div>

            <section aria-labelledby="preview-desc">
              <h4 id="preview-desc" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('assignment_info.description', 'Description')}</h4>
              <p className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-sm leading-relaxed text-foreground" dir="auto">
                {p.description || t('assignment_info.no_description', 'No description was written.')}
              </p>
            </section>

            {facts.length > 0 && (
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {facts.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="break-words font-medium text-foreground" dir="auto">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            <section aria-labelledby="preview-files">
              <h4 id="preview-files" className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                {t('assignment_info.attachments', 'Attachments ({{count}})', { count: p.attachments.length })}
              </h4>
              {p.attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('assignment_info.no_attachments', 'No attachments.')}</p>
              ) : (
                <ul className="space-y-1">
                  {p.attachments.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-1.5 text-sm">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate" dir="auto">{f.name}</span>
                      <Badge variant="outline" className="text-[10px]">{f.type}</Badge>
                      {f.size != null && <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(f.size)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex gap-2 rounded-xl border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-semibold text-foreground">{t('assignment_info.locked_title', 'Locked until you are engaged')}. </span>
                {t('assignment_info.locked_body', 'Files, credentials, remote-access data, links and contact details unlock after the NDA, an approved rate and the assignment. The company name and identifying details are hidden.')}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="ghost" onClick={onClose}>{t('assignment_info.close', 'Close')}</Button>
          {p && actions}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

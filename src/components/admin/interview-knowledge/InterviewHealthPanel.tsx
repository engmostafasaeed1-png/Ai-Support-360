import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { safeRpc } from '@/lib/safeRpc';

type Health = { last_success: string | null; last_error: { at: string; status: number; message: string } | null };
export default function InterviewHealthPanel() {
  const { t, i18n } = useTranslation();
  const health = useQuery({ queryKey: ['admin-interview-health'], retry: false, queryFn: async () => {
    const result = await safeRpc<Health>('admin_interview_health');
    if (result.error) throw new Error(t('interview.health_pending'));
    return result.data;
  } });
  const time = (value?: string | null) => value ? new Date(value).toLocaleString(i18n.language) : t('interview.health_none');
  return <section className="space-y-3 border-b border-border pb-4" aria-label={t('interview.health_title')}>
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-foreground">{t('interview.health_title')}</h2>
      <Button variant="ghost" size="icon" busy={health.isFetching} aria-label={t('common.refresh')} title={t('common.refresh')} onClick={() => void health.refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
    {health.error ? <p role="status" className="text-sm text-muted-foreground">{t('interview.health_pending')}</p> : <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t('interview.health_success')}</dt><dd>{time(health.data?.last_success)}</dd></div>
      <div><dt className="text-muted-foreground">{t('interview.health_error')}</dt><dd className="break-words">{time(health.data?.last_error?.at)}{health.data?.last_error && <p>{health.data.last_error.message}</p>}</dd></div>
    </dl>}
  </section>;
}
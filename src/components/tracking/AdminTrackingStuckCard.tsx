import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { adminTrackingOverview } from '@/lib/tracking/api';
import { normalizeSettings, statusLabel } from '@/lib/ticketTracking';
import { actorText } from '@/lib/tracking/timelineText';

/** Admin overview: open tickets stuck in one working status for more than N days (admin setting). */
export default function AdminTrackingStuckCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data } = useQuery({
    queryKey: ['tt-admin-overview'],
    queryFn: async () => (await adminTrackingOverview()).data,
    staleTime: 60_000,
    retry: false,
  });
  if (!data) return null;
  const settings = normalizeSettings(data.settings);
  return (
    <Card className="rounded-2xl border-border/50" data-testid="tracking-stuck">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Hourglass className="h-4 w-4 text-warning" aria-hidden /> {t('tracking.admin.stuckTitle', { days: data.days })}
          {!settings.enabled && <Badge variant="outline" className="text-[10px]">{t('tracking.admin.off')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.stuck.length === 0 ? <p className="text-sm text-muted-foreground">{t('tracking.admin.noneStuck')}</p> : (
          <ul className="divide-y divide-border/60">
            {data.stuck.slice(0, 10).map((s) => (
              <li key={s.ticket_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link to={`/admin/tickets/${s.ticket_id}`} className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-primary">{s.title}</Link>
                <span className="text-xs text-muted-foreground">
                  {statusLabel(settings, s.status_key, lang)} · {t('tracking.dur.days', { n: s.days })}{s.set_by_role !== 'system' ? ` · ${actorText(t, s.set_by_role)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">{t('tracking.admin.changes7d', { n: data.changes_7d })}</p>
      </CardContent>
    </Card>
  );
}

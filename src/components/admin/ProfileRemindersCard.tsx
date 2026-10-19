import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

type Stats = { last_run: string | null; sent_today: number; incomplete: number; unsubscribed: number };

/** Small admin overview of the daily consultant profile reminders (Feature B). */
export default function ProfileRemindersCard() {
  const { t } = useTranslation();
  const stats = useQuery({
    queryKey: ['admin-profile-reminder-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_profile_reminder_stats');
      if (error) throw error;
      return data as Stats;
    },
    retry: false,
  });

  const rows: Array<[string, string]> = stats.data
    ? [
        [t('admin.reminders_last_run', 'Last reminder sent'), stats.data.last_run ? new Date(stats.data.last_run).toLocaleString() : '—'],
        [t('admin.reminders_sent_today', 'Reminders sent today'), String(stats.data.sent_today)],
        [t('admin.reminders_incomplete', 'Consultants still incomplete'), String(stats.data.incomplete)],
        [t('admin.reminders_unsubscribed', 'Unsubscribed'), String(stats.data.unsubscribed)],
      ]
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <MailCheck className="h-5 w-5 text-primary" />
        <CardTitle className="text-base">{t('admin.reminders_title', 'Profile reminder e-mails')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {stats.isPending && <Skeleton className="h-16 w-full" />}
        {stats.isError && (
          <p className="text-xs text-muted-foreground">
            {t('admin.reminders_unavailable', 'Reminder statistics are unavailable until the profile-reminders SQL is applied.')}
          </p>
        )}
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

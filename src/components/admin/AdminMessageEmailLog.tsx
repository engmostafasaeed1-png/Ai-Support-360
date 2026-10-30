import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { safeRpc } from '@/lib/safeRpc';
import type { DeliveryStatus } from '@/lib/adminMessageEmail';

interface Row {
  id: string; title: string | null; status: DeliveryStatus; reason: string | null; digest: boolean; important: boolean;
  kind: string; created_at: string; send_after: string; recipient_name: string | null; actor_name: string | null;
}

export function useAdminMessageEmailLog(userId?: string, limit = 20) {
  return useQuery({
    queryKey: ['admin-message-email-log', userId ?? 'all', limit],
    retry: false,
    // null until docs/sql/admin-message-email.sql is applied.
    queryFn: async (): Promise<Row[] | null> => {
      const { data, error } = await safeRpc<Row[]>('admin_message_email_log', { _user: userId ?? null, _limit: limit });
      return error ? null : (data ?? []);
    },
  });
}

const TONE: Record<DeliveryStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline', sending: 'outline', sent: 'default', skipped: 'secondary', failed: 'destructive',
};

/** Per-message e-mail delivery (queued / sent / skipped with reason / failed) for admin messages. */
export default function AdminMessageEmailLog({ userId, limit = 20 }: { userId?: string; limit?: number }) {
  const { t, i18n } = useTranslation();
  const q = useAdminMessageEmailLog(userId, limit);
  const fmt = (d: string) => new Date(d).toLocaleString(i18n.language?.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  if (q.isLoading) return null;
  if (q.data === null) return <p className="text-xs text-muted-foreground">{t('ame.not_ready', 'Delivery status appears once the prepared database update is applied.')}</p>;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">{t('um.none', 'None')}</p>;
  return (
    <ul className="space-y-1.5" aria-label={t('ame.log_title', 'E-mail copies of admin messages')}>
      {q.data.map((r) => {
        const held = r.status === 'queued' && new Date(r.send_after) > new Date();
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {r.title || '—'}
              {!userId && r.recipient_name ? <span className="text-muted-foreground"> · {r.recipient_name}</span> : null}
              {r.important ? <span className="text-muted-foreground"> · {t('ame.important_short', 'important')}</span> : null}
            </span>
            <Badge variant={TONE[r.status] ?? 'outline'} className="font-normal">
              {held ? t('ame.st_held', 'Waiting (digest)') : t(`ame.st_${r.status}`, r.status)}
              {r.digest && r.status === 'sent' ? ` · ${t('ame.digest', 'digest')}` : ''}
            </Badge>
            {r.reason && r.status !== 'sent' ? <span className="basis-full text-muted-foreground">{t(`ame.r_${r.reason}`, r.reason)}</span> : null}
            <span className="text-muted-foreground">{fmt(r.created_at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

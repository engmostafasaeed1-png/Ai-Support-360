import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';

interface Ack { consultant_id: string; version: number; accepted_at: string }

/** Latest acknowledgement per consultant (administrators read all rows); empty before the database update is applied. */
function useLatestAcks() {
  const { signedIn } = useSessionReady();
  return useQuery({
    queryKey: ['admin-policy-acks'],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async () => {
      const [acks, current] = await Promise.all([
        (supabase as any).from('consultant_policy_acknowledgements').select('consultant_id, version, accepted_at').order('version', { ascending: false }).limit(5000),
        (supabase as any).rpc('consultant_policy_current_version'),
      ]);
      if (acks.error) return null;
      const map = new Map<string, Ack>();
      for (const a of (acks.data ?? []) as Ack[]) if (!map.has(a.consultant_id)) map.set(a.consultant_id, a);
      return { map, current: typeof current.data === 'number' ? current.data : null };
    },
  });
}

/** "Policy accepted v1 on <date>" on the admin review screen. */
export default function PolicyAcceptedBadge({ consultantId }: { consultantId: string }) {
  const { t } = useTranslation();
  const q = useLatestAcks();
  if (!q.data) return null;
  const a = q.data.map.get(consultantId);
  if (!a) return <p className="text-xs text-warning" data-testid="policy-badge">{t('admin.policy.notAccepted', 'Policy not accepted yet')}</p>;
  const outdated = q.data.current != null && a.version < q.data.current;
  return (
    <p className={`text-xs ${outdated ? 'text-warning' : 'text-success'}`} data-testid="policy-badge">
      {t('admin.policy.acceptedOn', 'Policy accepted v{{v}} on {{date}}', { v: a.version, date: format(new Date(a.accepted_at), 'd MMM yyyy') })}
      {outdated ? ` · ${t('admin.policy.newerVersion', 'version {{v}} not yet', { v: q.data.current })}` : ''}
    </p>
  );
}

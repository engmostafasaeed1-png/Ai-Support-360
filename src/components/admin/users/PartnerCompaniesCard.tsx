import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { partnerApi } from '@/lib/partnerPortal';

/** Admin: mark checked companies as partners (needs docs/sql/partner-portal-mvp.sql). */
export default function PartnerCompaniesCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-partner-tenants'], queryFn: async () => {
    const { data, error } = await supabase.from('tenants').select('id, name, is_partner' as 'id, name').order('name').limit(500);
    if (error) return null;
    return (data ?? []) as unknown as { id: string; name: string; is_partner: boolean }[];
  } });
  if (q.data === null) return <p className="text-sm text-muted-foreground">{t('partner.admin_not_ready', 'Partner companies become available once the partner database update is applied.')}</p>;
  return (
    <Card className="rounded-2xl"><CardContent className="divide-y divide-border p-0">
      <p className="p-4 text-sm text-muted-foreground">{t('partner.admin_hint', 'Turn on only after you have checked the company. Partners can invite consultants and manage their availability.')}</p>
      {(q.data ?? []).map((tn) => (
        <label key={tn.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span>{tn.name}</span>
          <Switch checked={tn.is_partner} aria-label={tn.name} onCheckedChange={async (v) => {
            const r = await partnerApi.adminSetPartner(tn.id, v);
            if (r.error) toast.error(t('partner.error', 'Could not save. Please try again.'));
            qc.invalidateQueries({ queryKey: ['admin-partner-tenants'] });
          }} />
        </label>))}
    </CardContent></Card>
  );
}

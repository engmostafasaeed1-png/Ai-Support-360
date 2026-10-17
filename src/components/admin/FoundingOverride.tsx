import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useFoundingConsultants, FOUNDING_KEY } from '@/hooks/useFoundingConsultants';
import { activeAward } from '@/lib/foundingConsultants';
import FoundingBadge from '@/components/consultant/FoundingBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
export default function FoundingOverride({ consultantId }: { consultantId: string }) {
  const { t } = useTranslation(); const { toast } = useToast(); const qc = useQueryClient();
  const { data } = useFoundingConsultants(); const awarded = activeAward(data?.get(consultantId));
  const [reason,setReason] = useState(''); const [busy,setBusy] = useState(false);
  const change = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc('admin_set_founding_consultant',{ _cid: consultantId, _grant: !awarded, _reason: reason.trim() });
    setBusy(false);
    if (error) toast({ title: t('common.error','Error'), description: error.message, variant: 'destructive' });
    else { setReason(''); void qc.invalidateQueries({queryKey:FOUNDING_KEY}); void qc.invalidateQueries({queryKey:['founding-spots']}); toast({title:t('common.saved','Saved')}); }
  };
  return <section className="space-y-2"><h3 className="font-semibold">{t('founding.badge','Founding Consultant')}</h3><FoundingBadge consultantId={consultantId} numbered />
    <Label htmlFor="founding-reason">{t('founding.reason','Reason (recorded in audit log)')}</Label><Input id="founding-reason" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} />
    <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={change}>{awarded ? t('founding.revoke','Revoke badge') : t('founding.grant','Grant badge')}</Button>
  </section>;
}

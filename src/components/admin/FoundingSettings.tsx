import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
export default function FoundingSettings() {
  const { t } = useTranslation(); const { toast } = useToast(); const qc = useQueryClient();
  const [enabled, setEnabled] = useState(true); const [limit, setLimit] = useState('100'); const [boost, setBoost] = useState('0'); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['admin-founding-settings'], retry: false, queryFn: async () => {
    const { data, error } = await (supabase as any).rpc('admin_founding_settings');
    if (error) return null;
    setEnabled(data.enabled); setLimit(String(data.limit)); setBoost(String(data.boost_months)); return data;
  } });
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc('admin_founding_settings', { _enabled: enabled, _limit: Number(limit), _boost: Number(boost) });
    setBusy(false);
    if (error) toast({ title: t('common.error', 'Error'), description: error.message, variant: 'destructive' });
    else { toast({ title: t('common.saved', 'Saved') }); for (const key of ['admin-founding-settings','founding-spots','founding-boost']) void qc.invalidateQueries({ queryKey: [key] }); }
  };
  return <Card><CardHeader><CardTitle>{t('founding.badge','Founding Consultant')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {!q.isPending && !q.data && <p role="status" className="text-sm text-muted-foreground">{t('founding.unavailable','Founding Consultant setup is not active yet.')}</p>}
    <div className="flex items-center justify-between gap-3"><Label htmlFor="founding-enabled">{t('founding.enabled','Award Founding Consultant badges')}</Label><Switch id="founding-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!q.data || busy} /></div>
    <div><Label htmlFor="founding-limit">{t('founding.limit','Founding Consultant limit')}</Label><Input id="founding-limit" type="number" min={1} max={100000} value={limit} onChange={e=>setLimit(e.target.value)} disabled={!q.data || busy} /></div>
    <div><Label htmlFor="founding-boost">{t('founding.boost','Directory tie-break boost (months; 0 = off)')}</Label><Input id="founding-boost" type="number" min={0} max={120} placeholder="3" value={boost} onChange={e=>setBoost(e.target.value)} disabled={!q.data || busy} /></div>
    <Button onClick={save} disabled={!q.data || busy || !Number.isInteger(Number(limit)) || Number(limit)<1 || Number(limit)>100000 || !Number.isInteger(Number(boost)) || Number(boost)<0 || Number(boost)>120}>{t('common.save','Save')}</Button>
  </CardContent></Card>;
}

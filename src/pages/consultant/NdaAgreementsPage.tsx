import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Download, FileSignature, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import NdaStatusCard from '@/components/nda/NdaStatusCard';
import NDASigningModal from '@/components/consultant/NDASigningModal';
import { useNdaSigningSettings, useRefreshNda } from '@/hooks/useNdaSigning';
import { downloadNdaById } from '@/lib/nda/download';

interface Row { id: string; client_id: string; signed_at: string; client_signed_at: string | null; revoked_at: string | null; client_name: string }

/** The consultant's NDA agreements: status, downloads, reminders, legacy marks, signing a new NDA after a revocation. */
export default function NdaAgreementsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const strict = useNdaSigningSettings().data ?? null;
  const refresh = useRefreshNda();
  const [params] = useSearchParams();
  const focusId = params.get('nda');
  const [resign, setResign] = useState<{ consultantId: string; clientId: string; clientName: string } | null>(null);

  const me = useQuery({
    queryKey: ['nda-list-me'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      return (data?.id as string) ?? null;
    },
  });
  const list = useQuery({
    queryKey: ['nda-list', me.data],
    enabled: !!me.data,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('nda_agreements')
        .select('id, client_id, signed_at, client_signed_at, revoked_at')
        .eq('consultant_id', me.data!)
        .order('signed_at', { ascending: false });
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((n) => n.client_id as string))];
      const { data: names } = ids.length ? await supabase.from('profile_directory').select('user_id, display_name').in('user_id', ids) : { data: [] };
      const map = new Map((names ?? []).map((p) => [p.user_id as string, (p.display_name as string) || '']));
      return (data ?? []).map((n) => ({ ...(n as Omit<Row, 'client_name'>), client_name: map.get(n.client_id as string) || t('ndaSign.role.client') }));
    },
  });

  useEffect(() => {
    if (focusId && list.data?.length) document.getElementById(`nda-row-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, list.data]);

  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium' }).format(new Date(iso)) : '—');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><FileSignature className="h-6 w-6 text-primary" aria-hidden /> {t('ndaSign.page.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('ndaSign.page.subtitle')}</p>
      </div>
      {me.isLoading || list.isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
      ) : !me.data ? (
        <Card className="rounded-2xl"><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('ndaSign.page.noProfile')}</CardContent></Card>
      ) : list.isError ? (
        <Card className="rounded-2xl"><CardContent className="py-10 text-center text-sm text-destructive">{t('ndaSign.err.generic')}</CardContent></Card>
      ) : !list.data?.length ? (
        <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground">
          <FileSignature className="mx-auto mb-3 h-10 w-10 opacity-40" aria-hidden />
          <p>{t('ndaSign.page.empty')}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {list.data.map((n) => (
            <Card key={n.id} id={`nda-row-${n.id}`} className={`rounded-2xl border-border/50 ${focusId === n.id ? 'ring-2 ring-primary/40' : ''}`}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-foreground">{t('ndaSign.page.with', { name: n.client_name })}</h2>
                    <p className="text-xs text-muted-foreground">{t('ndaSign.page.signedOn', { date: fmt(n.signed_at) })}</p>
                  </div>
                  {n.revoked_at ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]"><ShieldOff className="h-3 w-3" aria-hidden /> {t('ndaSign.page.revoked')}</Badge>
                  ) : n.client_signed_at ? (
                    <Badge variant="secondary" className="gap-1 text-[10px]"><ShieldCheck className="h-3 w-3" aria-hidden /> {t('ndaSign.card.fully')}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">{t('ndaSign.card.waiting', { role: t('ndaSign.role.client') })}</Badge>
                  )}
                </div>
                {strict ? (
                  <NdaStatusCard ndaId={n.id} clientName={n.client_name}
                    onReviewAndSign={() => setResign({ consultantId: me.data!, clientId: n.client_id, clientName: n.client_name })} />
                ) : (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadNdaById(n.id, { clientName: n.client_name }, lang).catch(() => toast.error(t('ndaSign.err.download')))}>
                    <Download className="h-3.5 w-3.5" aria-hidden /> {t('ndaSign.card.downloadMine')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {resign && (
        <NDASigningModal open onOpenChange={(o) => { if (!o) setResign(null); }} consultantId={resign.consultantId} clientId={resign.clientId}
          clientName={resign.clientName} onSigned={() => { setResign(null); void refresh(); }} />
      )}
    </div>
  );
}

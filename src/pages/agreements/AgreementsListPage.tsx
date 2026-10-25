import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Handshake, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgreementsMine, useOpportunities, useRefreshAgreements } from '@/hooks/useAgreements';
import { AgreementStatusBadge, fmtDate, NotReadyCard, ProtectionBox } from '@/components/agreements/AgreementBits';
import AgreementRequestForm from '@/components/agreements/AgreementRequestForm';
import ApplyDialog from '@/components/agreements/ApplyDialog';
import * as api from '@/lib/agreements/api';

/** Support agreements: client (own company's agreements + new request) or consultant (opportunities + my agreements). */
export default function AgreementsListPage({ portal }: { portal: 'client' | 'consultant' }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const nav = useNavigate();
  const mine = useAgreementsMine();
  const refresh = useRefreshAgreements();
  const [creating, setCreating] = useState(false);
  const [applyTo, setApplyTo] = useState<api.SaOpportunity | null>(null);
  const opps = useOpportunities(portal === 'consultant' && !!mine.data?.enabled);

  if (mine.isLoading) return <div className="p-6"><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  const data = mine.data;
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Handshake className="h-6 w-6 text-primary" aria-hidden /> {t('agreements.title')}</h1>
        <p className="text-sm text-muted-foreground">{t(portal === 'client' ? 'agreements.introClient' : 'agreements.introConsultant')}</p></div>
      {portal === 'client' && data?.enabled && !creating && <Button onClick={() => setCreating(true)}><Plus className="me-1 h-4 w-4" />{t('agreements.new')}</Button>}
    </div>
  );
  if (!data?.ready || !data.enabled) return <div className="space-y-4 p-4 md:p-6">{head}<NotReadyCard disabled={data?.ready} /></div>;

  const list = (rows: api.SaListItem[]) => (
    <div className="grid gap-3 md:grid-cols-2">
      {!rows.length && <p className="text-sm text-muted-foreground">{t('agreements.empty')}</p>}
      {rows.map((r) => (
        <Link key={r.id} to={`/${portal}/agreements/${r.id}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full rounded-2xl transition-shadow hover:shadow-md"><CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2"><p className="font-semibold">{r.name}</p><AgreementStatusBadge status={r.status} /></div>
            <p className="text-sm text-muted-foreground">{r.modules.join(', ') || '—'} · {t(`agreements.model.${r.model}`, { defaultValue: '—' })}</p>
            <p className="text-xs text-muted-foreground">{fmtDate(r.start_date, lang)} – {r.end_date ? fmtDate(r.end_date, lang) : t('agreements.f.openEnded')}</p>
            <div className="flex flex-wrap gap-1.5"><Badge variant="outline">{t(`agreements.role.${r.role}`, { defaultValue: r.role })}</Badge>
              {r.applications ? <Badge variant="secondary">{t('agreements.applicationsN', { count: r.applications })}</Badge> : null}</div>
          </CardContent></Card>
        </Link>
      ))}
    </div>
  );

  if (portal === 'client') {
    return (
      <div className="space-y-4 p-4 md:p-6">
        {head}
        {creating ? (
          <AgreementRequestForm settings={data.settings} onCancel={() => setCreating(false)} onSaved={(id) => { setCreating(false); refresh(); nav(`/client/agreements/${id}`); }} />
        ) : (
          <>{list(data.agreements)}<ProtectionBox /></>
        )}
      </div>
    );
  }

  const myAgreements = data.agreements.filter((a) => ['lead', 'team'].includes(a.role));
  const applications = data.agreements.filter((a) => a.role === 'applicant');
  return (
    <div className="space-y-4 p-4 md:p-6">
      {head}
      {data.replacements.map((r) => (
        <Card key={r.id} className="rounded-2xl border-warning/50"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <p>{t('agreements.replacementOffer', { name: r.name })}</p>
          <div className="flex gap-2"><Button size="sm" onClick={() => api.replacementAccept(r.id, true).then(refresh)}>{t('agreements.accept')}</Button>
            <Button size="sm" variant="ghost" onClick={() => api.replacementAccept(r.id, false).then(refresh)}>{t('agreements.decline')}</Button></div>
        </CardContent></Card>
      ))}
      <Tabs defaultValue={myAgreements.length ? 'mine' : 'opportunities'}>
        <TabsList><TabsTrigger value="opportunities">{t('agreements.tab.opportunities')} ({opps.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="applications">{t('agreements.tab.myApplications')} ({applications.length})</TabsTrigger>
          <TabsTrigger value="mine">{t('agreements.tab.mine')} ({myAgreements.length})</TabsTrigger></TabsList>
        <TabsContent value="opportunities" className="space-y-3">
          {opps.isLoading ? <Skeleton className="h-32 w-full rounded-2xl" /> : !opps.data?.length ? <p className="text-sm text-muted-foreground">{t('agreements.noOpportunities')}</p> : (
            <div className="grid gap-3 md:grid-cols-2">
              {opps.data.map((o) => (
                <Card key={o.id} className="rounded-2xl"><CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2"><Link to={`/consultant/agreements/${o.id}`} className="font-semibold hover:underline">{o.name}</Link>
                    {o.invited && <Badge>{t('agreements.invited')}</Badge>}</div>
                  <p className="text-sm text-muted-foreground">{o.modules.join(', ')} · {t(`agreements.model.${o.model}`)}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(o.term?.start_date, lang)} – {o.term?.end_date ? fmtDate(o.term.end_date, lang) : t('agreements.f.openEnded')}
                    {o.request.expected_hours_per_month ? ` · ${t('agreements.f.hoursMonth', { count: o.request.expected_hours_per_month })}` : ''}</p>
                  {o.deadline && <p className="text-xs text-warning">{t('agreements.deadlineOn', { date: fmtDate(o.deadline, lang) })}</p>}
                  <p className="line-clamp-2 text-xs text-muted-foreground">{o.sla?.summary || t('agreements.f.slaDefault')}</p>
                  <div className="flex gap-2 pt-1">{o.applied ? <Badge variant="secondary">{t('agreements.applied')}</Badge> : <Button size="sm" onClick={() => setApplyTo(o)}>{t('agreements.apply.cta')}</Button>}
                    <Button size="sm" variant="ghost" asChild><Link to={`/consultant/agreements/${o.id}`}>{t('agreements.details')}</Link></Button></div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="applications">{list(applications)}</TabsContent>
        <TabsContent value="mine">{list(myAgreements)}</TabsContent>
      </Tabs>
      <ProtectionBox />
      {applyTo && <ApplyDialog open onOpenChange={(v) => !v && setApplyTo(null)} agreementId={applyTo.id} name={applyTo.name} modules={applyTo.modules} model={applyTo.model}
        sla={applyTo.sla} settings={data.settings} onDone={refresh} />}
    </div>
  );
}

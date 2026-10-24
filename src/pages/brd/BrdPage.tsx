import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrd, useRefreshBrd } from '@/hooks/useBrd';
import BrdWizard from '@/components/brd/BrdWizard';
import BrdWorkspace from '@/components/brd/BrdWorkspace';
import BrdReader from '@/components/brd/BrdReader';
import BrdApprovalPanel from '@/components/brd/approval/BrdApprovalPanel';
import { announceReport } from '@/components/brd/aiFeedback';
import { normalizeContent, type BrdContent } from '../../../supabase/functions/_shared/brdModel';

/** /client/tickets/:id/brd, /admin/tickets/:id/brd, /consultant/cases/:id/brd (and /consultant/tickets/:id/brd). */
export default function BrdPage() {
  const { t } = useTranslation();
  const params = useParams<{ ticketId?: string; caseId?: string }>();
  const ticketId = params.ticketId ?? params.caseId;
  const { pathname } = useLocation();
  const area = pathname.startsWith('/admin') ? 'admin' : pathname.startsWith('/consultant') ? 'consultant' : 'client';
  const back = area === 'admin' ? `/admin/tickets/${ticketId}` : area === 'consultant' ? `/consultant/cases/${ticketId}` : `/client/tickets/${ticketId}`;
  const { data, isLoading, error } = useBrd(ticketId);
  const refresh = useRefreshBrd(ticketId);
  const [created, setCreated] = useState<BrdContent | null>(null);
  const initial = useMemo(() => (data?.brd?.draft ? normalizeContent(data.brd.draft) : null), [data?.brd?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div className="flex items-center gap-3">
      <Link to={back}><Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t('brd.back')}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></Button></Link>
      <div className="min-w-0">
        <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5 text-accent shrink-0" /> {t('brd.title')}</h1>
        {data?.ticket && <p className="text-sm text-muted-foreground truncate">#{data.ticket.ref} · {data.ticket.title}</p>}
      </div>
    </div>
  );

  if (isLoading) return <div className="space-y-4">{header}<Skeleton className="h-64 rounded-2xl" /></div>;
  const notice = (title: string, body: string) => (
    <div className="space-y-4">{header}
      <Card className="rounded-2xl"><CardContent className="p-6 flex gap-3"><ShieldAlert className="h-5 w-5 text-muted-foreground shrink-0" />
        <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground mt-1">{body}</p></div></CardContent></Card>
    </div>
  );
  if (error || !data) return notice(t('brd.unavailable.title'), error?.notReady ? t('brd.unavailable.notReady') : t('brd.unavailable.body'));
  if (!data.role) return notice(t('brd.noAccess.title'), area === 'consultant' ? t('brd.noAccess.consultant') : t('brd.noAccess.body'));
  if (!data.enabled && data.role !== 'admin') return notice(t('brd.off.title'), t('brd.off.body'));

  const writerRole = data.role === 'client' || data.role === 'admin';
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {header}
      {!data.enabled && data.role === 'admin' && <p className="text-xs rounded-lg bg-warning/15 p-2">{t('brd.off.adminNote')}</p>}
      {ticketId && data.ticket && <BrdApprovalPanel ticketId={ticketId} state={data} />}
      {writerRole && !data.brd && !created && data.can_write && (
        <BrdWizard state={data} onCreated={(c, report) => { announceReport(t, report); setCreated(c); }} />
      )}
      {writerRole && !data.brd && !created && !data.can_write && notice(t('brd.closed.title'), t('brd.closedBanner'))}
      {writerRole && (data.brd || created) && (
        <BrdWorkspace key={data.brd?.id ?? 'new'} state={data} initial={initial ?? created!} initialRev={data.brd?.draft_rev ?? null}
          fresh={!data.brd} isAdmin={data.role === 'admin'} refresh={refresh} />
      )}
      {!writerRole && <BrdReader state={data} refresh={refresh} />}
    </div>
  );
}

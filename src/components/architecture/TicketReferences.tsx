import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Ticket, ExternalLink, CheckCircle2, Clock, AlertTriangle, Filter, FileText } from 'lucide-react';
import { useClientTickets } from '@/hooks/useClientTickets';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ArchListRow } from '@/lib/architecture/api';
import { TYPE_TITLES } from '../../../supabase/functions/_shared/archModel';
import ArchStatusBadge from './ArchStatusBadge';

const statusCfg: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  new: { color: 'bg-accent/10 text-accent-foreground', icon: Clock },
  open: { color: 'bg-secondary text-secondary-foreground', icon: AlertTriangle },
  in_progress: { color: 'bg-primary/10 text-primary', icon: Clock },
  resolved: { color: 'bg-primary/10 text-primary', icon: CheckCircle2 },
  closed: { color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
};

/**
 * Real tickets of the client (or company). When architecture documents exist (database update applied), each
 * ticket also lists the documents linked to it.
 */
export default function TicketReferences({ searchQuery, docsByTicket }: { searchQuery: string; docsByTicket?: Map<string, ArchListRow[]> | null }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const { data: tickets, isLoading } = useClientTickets();
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('all');
  const [onlyLinked, setOnlyLinked] = useState(false);

  const filtered = (tickets || []).filter((tk) => {
    if (filterStatus !== 'all' && tk.status !== filterStatus) return false;
    if (onlyLinked && !(docsByTicket?.get(tk.id)?.length)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return tk.title.toLowerCase().includes(q) || tk.sap_module?.toLowerCase().includes(q) || tk.id.toLowerCase().includes(q)
        || (docsByTicket?.get(tk.id) ?? []).some((d) => d.title.toLowerCase().includes(q));
    }
    return true;
  });

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Card key={i} className="rounded-2xl border-border/50 animate-pulse"><CardContent className="p-5 h-24" /></Card>)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-9 text-xs" aria-label={t('arch.fields.status')}>
              <Filter className="w-3.5 h-3.5 me-1" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('arch.list.allStatuses')}</SelectItem>
              {['new', 'in_progress', 'resolved', 'closed'].map((s) => <SelectItem key={s} value={s}>{t(`arch.ticketStatus.${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          {docsByTicket && (
            <Button size="sm" variant={onlyLinked ? 'secondary' : 'outline'} className="h-9 text-xs" aria-pressed={onlyLinked} onClick={() => setOnlyLinked(!onlyLinked)}>
              {t('arch.refs.onlyLinked')}
            </Button>
          )}
          <Badge variant="secondary" className="text-xs">{t('arch.refs.count', { count: filtered.length })}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{docsByTicket ? t('arch.refs.hint') : t('arch.refs.hintNoDocs')}</p>
      </div>

      {filtered.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="py-12 text-center">
            <Ticket className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('arch.refs.none')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((ticket) => {
            const sc = statusCfg[ticket.status] || statusCfg.new;
            const StatusIcon = sc.icon;
            const docs = docsByTicket?.get(ticket.id) ?? [];
            return (
              <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0"><Ticket className="w-4 h-4 text-primary" aria-hidden /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] font-mono text-muted-foreground">{ticket.id.slice(0, 8).toUpperCase()}</span>
                        <Badge variant="outline" className={`text-[9px] ${sc.color}`}><StatusIcon className="w-3 h-3 me-0.5" aria-hidden />{t(`arch.ticketStatus.${ticket.status}`, ticket.status)}</Badge>
                        {ticket.sap_module && <Badge variant="secondary" className="text-[9px]">{ticket.sap_module}</Badge>}
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{ticket.title}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('arch.refs.openTicket')} onClick={() => navigate(`/client/tickets/${ticket.id}`)}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {docs.length > 0 && (
                    <ul className="ms-13 flex flex-wrap gap-2" aria-label={t('arch.refs.linkedDocs')}>
                      {docs.map((d) => (
                        <li key={d.id}>
                          <Link to={`/client/solution-architecture/${d.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs hover:border-primary">
                            <FileText className="h-3 w-3 text-primary" aria-hidden />
                            <span className="font-medium">{TYPE_TITLES[d.type].short}</span>
                            <span className="truncate max-w-48">{d.title}</span>
                            <ArchStatusBadge status={d.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {docsByTicket && docs.length === 0 && <p className="text-[11px] text-muted-foreground ps-13">{t('arch.refs.noDocs', { lng: ar ? 'ar' : undefined })}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

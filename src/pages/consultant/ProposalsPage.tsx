import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FileText, Clock, Calendar, Inbox, DollarSign, Star, ChevronDown } from 'lucide-react';
import SubmitProposalModal from '@/components/consultant/SubmitProposalModal';
import WithdrawBidButton from '@/components/consultant/WithdrawBidButton';
import CounterOfferBanner from '@/components/consultant/CounterOfferBanner';
import { useMyBids, useMyConsultant, useMyCounters, type MyBidRow } from '@/hooks/useBidding';
import { useNow } from '@/hooks/useCriticalService';
import { bidCountdown, latestBids, rejectionLine, toneClass } from '@/lib/bidding';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'pending' | 'accepted' | 'rejected' | 'withdrawn';

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Waiting for the client', className: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'Accepted', className: 'bg-green-100 text-green-700' },
  rejected: { label: 'Not chosen', className: 'bg-red-100 text-red-700' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Active' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Not chosen' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

const day = (d: string | null | undefined) => (d ? format(new Date(d), 'PP') : '');

function Timeline({ bid }: { bid: MyBidRow }) {
  const steps: { label: string; date?: string }[] = [{ label: 'Bid sent', date: day(bid.created_at) }];
  if (bid.shortlisted) steps.push({ label: 'Shortlisted' });
  if (bid.status === 'accepted') steps.push({ label: 'Accepted', date: day(bid.updated_at) });
  if (bid.status === 'rejected') steps.push({ label: 'Not chosen', date: day(bid.updated_at) });
  if (bid.status === 'withdrawn') steps.push({ label: 'Withdrawn', date: day(bid.withdrawn_at) });
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground" aria-label="Bid timeline">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">→</span>}
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          <span>{s.label}</span>
          {s.date && <span>{s.date}</span>}
        </li>
      ))}
    </ol>
  );
}

export default function ProposalsPage() {
  const navigate = useNavigate();
  const { data: rows, isLoading } = useMyBids();
  const { data: counters } = useMyCounters();
  const { data: me } = useMyConsultant();
  const [filter, setFilter] = useState<Filter>('all');
  const [params] = useSearchParams();
  const focus = params.get('ticket');
  const scrolled = useRef(false);
  const now = useNow(30_000);
  const money = (n: number) => (me?.currency ? `${me.currency} ${Number(n).toLocaleString()}` : `$${Number(n).toLocaleString()}`);

  const bids = useMemo(() => latestBids(rows || []), [rows]);
  const counterByTicket = useMemo(() => new Map((counters || []).map(c => [c.ticket_id, c])), [counters]);
  const count = (s: string) => bids.filter(b => b.bid.status === s).length;
  const shown = bids.filter(b => filter === 'all' || b.bid.status === filter);

  useEffect(() => {
    if (!focus || isLoading || scrolled.current) return;
    const el = document.getElementById(`bid-${focus}`);
    if (el) { scrolled.current = true; el.scrollIntoView({ block: 'center' }); }
  }, [focus, isLoading, bids]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My bids</h1>
        <p className="text-sm text-muted-foreground mt-1">The bids you placed on requests and what the clients answered.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total', value: bids.length, cls: 'text-foreground' },
          { label: 'Active', value: count('pending'), cls: 'text-amber-600' },
          { label: 'Accepted', value: count('accepted'), cls: 'text-green-600' },
          { label: 'Not chosen', value: count('rejected'), cls: 'text-destructive' },
          { label: 'Withdrawn', value: count('withdrawn'), cls: 'text-muted-foreground' },
        ].map(c => (
          <Card key={c.label} className="rounded-2xl border-border/50">
            <CardContent className="p-4 text-center">
              <p className={cn('text-2xl font-bold', c.cls)}>{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap" role="tablist">
        {FILTERS.map(f => (
          <Button key={f.key} role="tab" aria-selected={filter === f.key} size="sm" variant={filter === f.key ? 'default' : 'outline'}
            className={`text-xs rounded-full h-8 ${filter === f.key ? 'gradient-primary border-0' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : bids.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center space-y-3">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">You have not placed any bid yet.</p>
              <Button size="sm" onClick={() => navigate('/consultant/open-tickets')}>Browse open requests</Button>
            </CardContent>
          </Card>
        ) : shown.length === 0 ? (
          <Card className="rounded-2xl border-border/50"><CardContent className="py-8 text-center text-sm text-muted-foreground">No bids in this group.</CardContent></Card>
        ) : (
          shown.map(({ bid, history }) => {
            const t = bid.ticket;
            const openForBids = !!t?.open_for_bids && !(t.bid_deadline && new Date(t.bid_deadline).getTime() <= now);
            const cd = bidCountdown(t?.bid_deadline, now, openForBids);
            const cfg = STATUS[bid.status] ?? STATUS.pending;
            const reason = bid.status === 'rejected' ? rejectionLine(bid.rejection_reason) : null;
            const counter = counterByTicket.get(bid.ticket_id);
            const modal = (label: string) => (
              <SubmitProposalModal ticketId={bid.ticket_id} ticketTitle={t?.title || ''} bidDeadline={t?.bid_deadline} currency={me?.currency}
                trigger={<Button size="sm" variant="outline">{label}</Button>} />
            );
            return (
              <Card key={bid.id} id={`bid-${bid.ticket_id}`} className={cn('rounded-2xl border-border/50', focus === bid.ticket_id && 'ring-2 ring-accent')}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-accent shrink-0" />
                        {openForBids
                          ? <Link to={`/consultant/open-tickets?ticket=${bid.ticket_id}`} className="font-semibold text-foreground truncate hover:underline">{t?.title || 'Request'}</Link>
                          : <h3 className="font-semibold text-foreground truncate">{t?.title || 'Request'}</h3>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {t?.sap_module && <Badge variant="outline" className="text-[10px]">{t.sap_module}</Badge>}
                        <span className={toneClass[cd.tone]}>{cd.text}</span>
                        {bid.version && bid.version > 1 ? <Badge variant="outline" className="text-[10px]">v{bid.version}</Badge> : null}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> {money(bid.proposed_rate)}/hr</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {bid.estimated_hours} h</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {bid.timeline_days} days</span>
                        <span><span>Estimated total: </span><span dir="ltr">{money(Number(bid.proposed_rate) * Number(bid.estimated_hours))}</span></span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Badge variant="secondary" className={`text-[10px] ${cfg.className}`}>{cfg.label}</Badge>
                      {bid.shortlisted && <Badge variant="secondary" className="text-[10px] gap-1 bg-amber-100 text-amber-700"><Star className="w-3 h-3" /> Shortlisted</Badge>}
                    </div>
                  </div>
                  {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
                  {bid.client_notes && <p className="text-xs text-muted-foreground italic">Client: "{bid.client_notes}"</p>}
                  <Timeline bid={bid} />
                  {counter && (
                    <CounterOfferBanner counter={counter} bid={bid} money={money}
                      newVersion={counter.new_proposal_id ? (rows || []).find(r => r.id === counter.new_proposal_id)?.version : null} />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {bid.status === 'pending' && <>{modal('Revise bid')}<WithdrawBidButton bidId={bid.id} /></>}
                    {bid.status === 'accepted' && <Button size="sm" onClick={() => navigate(`/consultant/cases/${bid.ticket_id}`)}>Open the request</Button>}
                    {(bid.status === 'withdrawn' || bid.status === 'rejected') && openForBids && modal('Place a new bid')}
                  </div>
                  {history.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-accent hover:underline">
                        Version history <ChevronDown className="w-3 h-3" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          {history.map(h => (
                            <li key={h.id} className="flex flex-wrap gap-x-3">
                              <span>v{h.version ?? 1}</span>
                              <span dir="ltr">{money(h.proposed_rate)}/hr</span>
                              <span>{h.estimated_hours} h</span>
                              <span>{h.timeline_days} days</span>
                              <span>{day(h.created_at)}</span>
                              <span>{h.rejection_reason === 'superseded' ? 'Replaced by a newer version' : (STATUS[h.status]?.label ?? h.status)}</span>
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

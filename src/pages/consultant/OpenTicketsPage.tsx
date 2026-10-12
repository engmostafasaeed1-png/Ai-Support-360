import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Search, Gavel, Inbox, Clock, Globe, AlarmClock, CheckCircle2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import SubmitProposalModal from '@/components/consultant/SubmitProposalModal';
import OpenRequestPanel from '@/components/consultant/OpenRequestPanel';
import { formatDistanceToNow } from 'date-fns';
import { useNow } from '@/hooks/useCriticalService';
import ClientRatingChip from '@/components/consultant/ClientRatingChip';
import { useClientRatingSummaries } from '@/hooks/useClientRatings';
import { useMyBids, useMyConsultant, useTicketBidCounts, type MyBidRow } from '@/hooks/useBidding';
import { formatCountdown, formatPercent, msLeft } from '@/lib/criticalService';
import {
  bidCardState, bidCountdown, bidsSoFar, filterAndSortRequests, latestBids, matchCount, ticketAreas, toneClass, type BidSort,
} from '@/lib/bidding';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

function useOpenTickets() {
  return useQuery({
    queryKey: ['open-tickets-for-bidding'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tickets')
        .select('id, title, client_id, description, sap_module, sap_modules, urgency, status, created_at, preferred_session_type, preferred_language, open_for_bids, opened_for_bids_at, bid_deadline, bidding_closed_at, critical_response, critical_due_at, critical_surcharge_percent, critical_status')
        // the database decides what this consultant may see: tickets open for bids and tickets they were invited to
        .in('status', ['new', 'under_review'])
        .is('consultant_id', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export default function OpenTicketsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [urgency, setUrgency] = useState('all');
  const [sort, setSort] = useState<BidSort>('closing');
  const [matchOnly, setMatchOnly] = useState<boolean | null>(null);
  const { data: rawTickets, isLoading } = useOpenTickets();
  const { data: me } = useMyConsultant();
  const { data: myRows } = useMyBids();
  const skills = me?.skills ?? [];
  const matchOn = matchOnly ?? skills.length > 0;
  const clock = useNow(30_000);
  // a request open for bids whose deadline has passed is no longer listed; a private invitation stays
  const tickets = useMemo(() => (rawTickets || []).filter(t => !(t.open_for_bids && t.bid_deadline && new Date(t.bid_deadline).getTime() <= clock)), [rawTickets, clock]);
  const { data: ratings } = useClientRatingSummaries(tickets.map(t => t.client_id).filter(Boolean));
  const { data: counts } = useTicketBidCounts(tickets.map(t => t.id));
  const myBid = useMemo(() => {
    const m = new Map<string, MyBidRow>();
    for (const { bid } of latestBids(myRows || [])) m.set(bid.ticket_id, bid);
    return m;
  }, [myRows]);

  const [searchParams, setSearchParams] = useSearchParams();
  // the notice of a critical request links here with ?critical=<ticket id>: that ticket is highlighted
  const focusId = searchParams.get('critical');
  const deepId = searchParams.get('ticket');
  const [panelId, setPanelId] = useState<string | null>(null);
  const scrolled = useRef(false);
  const deepHandled = useRef<string | null>(null);
  const hasOpenCritical = tickets.some(t => t.critical_response && !!t.critical_due_at && new Date(t.critical_due_at).getTime() > Date.now());
  const now = useNow(hasOpenCritical ? 1000 : 0);
  const isCriticalOpen = (t: { critical_response?: boolean | null; critical_due_at?: string | null }) =>
    !!t.critical_response && msLeft(t.critical_due_at, now) > 0;

  useEffect(() => {
    if (!focusId || isLoading || scrolled.current) return;
    const el = document.getElementById(`ticket-${focusId}`);
    if (el) { scrolled.current = true; el.scrollIntoView({ block: 'center' }); }
  }, [focusId, isLoading, tickets]);

  useEffect(() => {
    if (!deepId || isLoading || !rawTickets || deepHandled.current === deepId) return;
    deepHandled.current = deepId;
    if (tickets.some(t => t.id === deepId)) setPanelId(deepId);
    else toast.error('This request is no longer open for bids.');
  }, [deepId, isLoading, rawTickets, tickets]);

  const filtered = filterAndSortRequests(tickets, { search, matchOnly: matchOn, urgency, sort, skills });
  const ordered = [...filtered].sort((a, b) => Number(isCriticalOpen(b)) - Number(isCriticalOpen(a)));
  const panelTicket = tickets.find(t => t.id === panelId) ?? null;

  const closePanel = (o: boolean) => {
    if (o) return;
    setPanelId(null);
    if (deepId) { const p = new URLSearchParams(searchParams); p.delete('ticket'); setSearchParams(p, { replace: true }); }
  };

  const bidButtons = (ticket: any) => {
    const bid = myBid.get(ticket.id);
    const state = bidCardState(bid);
    const modal = (label: string, primary: boolean) => (
      <SubmitProposalModal
        ticketId={ticket.id}
        ticketTitle={ticket.title}
        criticalPercent={isCriticalOpen(ticket) ? ticket.critical_surcharge_percent : null}
        criticalDueAt={isCriticalOpen(ticket) ? ticket.critical_due_at : null}
        bidDeadline={ticket.bid_deadline}
        bidCount={counts?.get(ticket.id) ?? 0}
        currency={me?.currency}
        trigger={<Button size="sm" variant={primary ? 'default' : 'outline'} className={primary ? 'gradient-primary border-0 text-xs' : 'text-xs'}>{label}</Button>}
      />
    );
    if (state === 'none') return modal('Place a bid', true);
    if (state === 'pending') return (
      <>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate(`/consultant/proposals?ticket=${ticket.id}`)}>View my bid</Button>
        {modal('Revise bid', false)}
      </>
    );
    if (state === 'withdrawn') return modal('Place a new bid', true);
    return null;
  };

  const stateBadge = (ticket: any) => {
    const bid = myBid.get(ticket.id);
    const state = bidCardState(bid);
    if (state === 'pending') return (
      <span className="flex items-center gap-1.5 text-xs">
        <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent">You bid</Badge>
        <span className="text-muted-foreground" dir="ltr">{`${me?.currency ? `${me.currency} ` : '$'}${bid!.proposed_rate}/hr · ${bid!.estimated_hours} h`}</span>
      </span>
    );
    if (state === 'accepted') return <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">Accepted</Badge>;
    if (state === 'rejected') return <Badge variant="secondary" className="text-[10px]">Not chosen</Badge>;
    if (state === 'withdrawn') return <Badge variant="secondary" className="text-[10px]">Withdrawn</Badge>;
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Gavel className="w-6 h-6 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Open requests</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Requests where you can place a bid.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{tickets.length}</p>
            <p className="text-xs text-muted-foreground">Open requests</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-orange-600">{tickets.filter(t => t.urgency === 'high' || t.urgency === 'critical').length}</p>
            <p className="text-xs text-muted-foreground">High Priority</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-accent">{new Set(tickets.flatMap(t => ticketAreas(t))).size}</p>
            <p className="text-xs text-muted-foreground">SAP Modules</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 w-full lg:max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search requests..." aria-label="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="match-only" checked={matchOn} onCheckedChange={v => setMatchOnly(v)} />
          <Label htmlFor="match-only" className="text-sm">Module match only</Label>
        </div>
        <Select value={urgency} onValueChange={setUrgency}>
          <SelectTrigger className="w-36 h-10 rounded-xl" aria-label="Urgency"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={v => setSort(v as BidSort)}>
          <SelectTrigger className="w-40 h-10 rounded-xl" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="closing">Closing soon</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="match">Best match</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Request list */}
      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : ordered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center space-y-3">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">No open requests match your filters.</p>
              {matchOn && <Button variant="outline" size="sm" onClick={() => setMatchOnly(false)}>Show all requests</Button>}
            </CardContent>
          </Card>
        ) : (
          ordered.map(ticket => {
            const cd = bidCountdown(ticket.bid_deadline, clock);
            const matched = matchCount(ticket, skills) > 0;
            return (
              <Card key={ticket.id} id={`ticket-${ticket.id}`} role="button" tabIndex={0}
                onClick={() => setPanelId(ticket.id)}
                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPanelId(ticket.id); } }}
                className={`rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isCriticalOpen(ticket) ? 'border-red-400 ring-1 ring-red-300' : ''} ${focusId === ticket.id ? 'ring-2 ring-red-500' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <h3 className="font-semibold text-foreground">{ticket.title}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {ticketAreas(ticket).map(a => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)}
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency || 'medium']}`}>{ticket.urgency || 'medium'}</Badge>
                        {matched && <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Module match</Badge>}
                        <Badge variant="secondary" className="text-[9px] bg-accent/10 text-accent gap-1">
                          <Globe className="w-2.5 h-2.5" /> {ticket.open_for_bids ? 'Accepting bids' : 'Private invitation'}
                        </Badge>
                        {isCriticalOpen(ticket) && (
                          <Badge variant="secondary" className="text-[10px] bg-red-600 text-white gap-1 animate-pulse">
                            <AlarmClock className="w-2.5 h-2.5" /> {`CRITICAL +${formatPercent(ticket.critical_surcharge_percent)} - ${formatCountdown(msLeft(ticket.critical_due_at, now))} left`}
                          </Badge>
                        )}
                        {ticket.critical_response && !isCriticalOpen(ticket) && (
                          <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700">Critical request</Badge>
                        )}
                      </div>
                      {ticket.client_id && ratings && <ClientRatingChip clientId={ticket.client_id} summary={ratings.get(ticket.client_id) ?? null} />}
                      {ticket.description && <p className="text-xs text-muted-foreground line-clamp-2">{ticket.description}</p>}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className={toneClass[cd.tone]} title={ticket.bid_deadline ? new Date(ticket.bid_deadline).toLocaleString() : undefined}>{cd.text}</span>
                        <span className="text-muted-foreground">{bidsSoFar(counts?.get(ticket.id))}</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</span>
                        <Link to={`/consultant/tickets/${ticket.id}`} className="text-accent hover:underline" onClick={e => e.stopPropagation()}>Full request page</Link>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                      {stateBadge(ticket)}
                      <div className="flex flex-wrap justify-end gap-2">{bidButtons(ticket)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <OpenRequestPanel
        request={panelTicket}
        open={!!panelTicket}
        onOpenChange={closePanel}
        bidCount={panelTicket ? counts?.get(panelTicket.id) ?? 0 : 0}
        ratingSummary={panelTicket?.client_id && ratings ? ratings.get(panelTicket.client_id) ?? null : undefined}
        actions={panelTicket ? <>{stateBadge(panelTicket)}{bidButtons(panelTicket)}</> : null}
      />
    </div>
  );
}

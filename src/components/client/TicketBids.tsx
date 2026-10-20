import FoundingBadge from '@/components/consultant/FoundingBadge';
import FavouriteButton from '@/components/favourites/FavouriteButton';
import { Fragment, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { ChevronDown, ChevronUp, CheckCircle2, Clock, ShieldCheck, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useRespondToProposal } from '@/hooks/useProposals';
import { useBiddingClock, useTicketBids, useTicketQuestions, useShortlist, useCancelCounter, useCloseBidding } from '@/hooks/useClientBids';
import { compareBids, comparisonHighlights, estimatedTotal, biddingIsOpen, biddingStatus, type BiddingTicket, type ComparisonSort } from '@/lib/clientBidding';
import { formatRemaining } from '@/lib/bidding';
import { useCriticalView } from '@/hooks/useCriticalService';
import { effectiveRate, formatPercent, surchargeApplies } from '@/lib/criticalService';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import CompletionBadge from '@/components/consultant/CompletionBadge';
import ResponsivenessChip from '@/components/consultant/ResponsivenessChip';
import { BlendedRatingStars } from '@/components/consultant/ResponsivenessRating';
import ConsultantLocation from '@/components/consultant/ConsultantLocation';
import BidCounterDialog from './BidCounterDialog';
import BidDeclineDialog from './BidDeclineDialog';
import BidDeadlineDialog from './BidDeadlineDialog';
import BidQuestions from './BidQuestions';

const sorts: { value: ComparisonSort; label: string }[] = [{ value: 'default', label: 'Shortlisted first' }, { value: 'rate', label: 'Rate per hour' }, { value: 'total', label: 'Estimated total' }, { value: 'timeline', label: 'Timeline days' }, { value: 'rating', label: 'Rating' }, { value: 'newest', label: 'Newest' }];
function Attachment({ attachment }: { attachment: any }) {
  const open = async () => {
    const { data, error } = await supabase.storage.from('proposal-documents').createSignedUrl(attachment.file_url, 3600);
    if (error) { toast.error(error.message); return; }
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  return <Button variant="link" size="sm" onClick={open}><Paperclip className="h-3 w-3 me-1" />{attachment.file_name}</Button>;
}
export default function TicketBids({ ticketId, ticket = {}, onInvite = () => {}, readOnly = false }: { ticketId: string; ticket?: BiddingTicket; onInvite?: () => void; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const { data, isLoading, error } = useTicketBids(ticketId);
  const { data: questions = [], error: questionError } = useTicketQuestions(ticketId);
  const { data: critical } = useCriticalView(ticketId);
  const now = useBiddingClock();
  const [sort, setSort] = useState<ComparisonSort>('default');
  const [descending, setDescending] = useState(false);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [counterBid, setCounterBid] = useState<any>(null);
  const [declineBid, setDeclineBid] = useState<string | null>(null);
  const [acceptBid, setAcceptBid] = useState<any>(null);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const shortlist = useShortlist();
  const cancelCounter = useCancelCounter();
  const close = useCloseBidding();
  const accept = useRespondToProposal();
  const reportError = (e: any) => toast.error(e.message);
  const rows = data?.bids.map(r => r.bid) || [];
  const pending = compareBids(rows);
  const bids = compareBids(rows, sort, shortlistOnly, descending);
  const highlights = comparisonHighlights(pending);
  const open = biddingIsOpen(ticket, now);
  const assigned = !!ticket.consultant_id || ticket.bidding_closed_reason === 'assigned';
  const counterFor = (bid: any) => data?.counters.find((c: any) => c.consultant_id === bid.consultant_id);
  const setDeadline = (reopening = false) => { setReopen(reopening); setDeadlineOpen(true); };
  const sortBy = (value: ComparisonSort) => { setDescending(sort === value ? !descending : false); setSort(value); };
  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;
  if (error) return <p role="alert" className="text-destructive">{error.message}</p>;
  const consultant = (p: any) => <div className="flex items-start gap-2 min-w-0">
    <div className="h-9 w-9 shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center text-xs">{p.consultant_avatar ? <img src={p.consultant_avatar} alt={p.consultant_name} className="h-full w-full object-cover" /> : p.consultant_name.slice(0, 2)}</div>
    <div className="min-w-0 space-y-1"><Link to={`/client/consultants/${p.consultant_id}`} className="font-semibold text-sm text-accent break-words">{p.consultant_name}</Link><FavouriteButton consultantId={p.consultant_id} name={p.consultant_name} size="sm" className="ms-1 align-middle" />
      {p.verification_status === 'verified' && <Badge variant="outline" className="ms-1 text-success gap-1"><ShieldCheck className="h-3 w-3" />Verified</Badge>}
      <ConsultantLocation audience="client" city={p.city} country={p.country} className="text-[11px] text-muted-foreground" />
      <BlendedRatingStars consultantId={p.consultant_id} rating={Number(p.consultant_rating)} reviews={Number(p.consultant_reviews)} size="sm" />
      <FoundingBadge consultantId={p.consultant_id} />
      <TrustBadge credits={p.credibility_credits} badge={p.ai_interview_badge} />
      <CompletionBadge percent={p.completion_percent ?? 0} tier={p.ai_interview_badge} />
      <ResponsivenessChip consultantId={p.consultant_id} />
    </div>
  </div>;
  const chips = (p: any) => { const counter = counterFor(p); return <div className="flex flex-wrap gap-1">
    {p.shortlisted && <Badge variant="secondary">Shortlisted</Badge>}
    {Number(p.version || 1) > 1 && <Badge variant="outline">Revised v{p.version}</Badge>}
    {estimatedTotal(p) === highlights.lowest && <Badge className="bg-success/10 text-success border-success/20">Lowest total</Badge>}
    {Number(p.timeline_days) === highlights.fastest && <Badge variant="outline">Fastest</Badge>}
    {counter && <Badge variant="secondary">{counter.status === 'accepted' ? 'Counter-offer accepted' : counter.status === 'declined' ? 'Counter-offer declined' : counter.status === 'cancelled' ? 'Counter-offer cancelled' : 'Counter-offer sent'}</Badge>}
    <span className="text-xs text-muted-foreground w-full">Bid sent {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</span>
  </div>; };
  const details = (p: any) => {
    const history = data?.bids.find(r => r.bid.id === p.id)?.history || [];
    const counter = counterFor(p);
    const criticalPercent = critical?.critical_response ? Number(critical.surcharge_percent ?? 0) : 0;
    return <div className="space-y-3 p-3 bg-muted/20">
      {p.cover_letter && <p className="text-sm whitespace-pre-wrap break-words">{p.cover_letter}</p>}
      {p.attachments.map((a: any) => <Attachment key={a.id} attachment={a} />)}
      {history.length > 0 && <details className="text-xs text-muted-foreground"><summary>Version history · {history.length}</summary>{history.map((h: any) => <div key={h.id} className="py-1">v{h.version || 1} · ${h.proposed_rate}/hr · {h.estimated_hours}h · {new Date(h.created_at).toLocaleString()}{h.attachments.map((a: any) => <Attachment key={a.id} attachment={a} />)}</div>)}</details>}
      {criticalPercent > 0 && (surchargeApplies(critical, p.consultant_id) ? <p className="text-xs text-success">{`Replied in time. If you accept this bid, +${formatPercent(criticalPercent)} is added: $${effectiveRate(Number(p.proposed_rate), criticalPercent)}/hr instead of $${p.proposed_rate}/hr.`}</p> : <p className="text-xs text-muted-foreground">Replied after the critical reply window: no surcharge.</p>)}
      {p.client_notes && <p className="text-xs text-muted-foreground">Your note: {p.client_notes}</p>}
      {!readOnly && !assigned && <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAcceptBid(p)}><CheckCircle2 className="h-3.5 w-3.5 me-1" />Accept bid</Button>
        <Button size="sm" variant="outline" disabled={shortlist.isPending} onClick={() => shortlist.mutate({ id: p.id, shortlisted: !p.shortlisted }, { onError: reportError })}>{p.shortlisted ? 'Remove from shortlist' : 'Shortlist'}</Button>
        {!counter && <Button size="sm" variant="outline" onClick={() => setCounterBid(p)}>Make a counter-offer</Button>}
        <Button size="sm" variant="outline" onClick={() => setDeclineBid(p.id)}>Decline</Button>
      </div>}
      {counter?.status === 'pending' && <div className="flex flex-wrap items-center gap-2 text-xs"><span>Waiting for the consultant</span>{!readOnly && <Button variant="link" size="sm" disabled={cancelCounter.isPending} onClick={() => cancelCounter.mutate(counter.id, { onError: reportError })}>Cancel counter-offer</Button>}</div>}
    </div>;
  };
  return <div className="space-y-5">
    <section className="border-b border-border pb-4 space-y-3">
      <h2 className="font-semibold">{biddingStatus(ticket, pending.length, rows.length, now)}</h2>
      {open && ticket.bid_deadline && <p title={new Date(ticket.bid_deadline).toLocaleString()} className="flex gap-1 items-center text-xs text-muted-foreground"><Clock className="h-3 w-3" />Closes in {formatRemaining(Date.parse(ticket.bid_deadline) - now)}</p>}
      {!readOnly && !assigned && <div className="flex flex-wrap gap-2">{open ? <><Button size="sm" variant="outline" onClick={() => setDeadline()}>{ticket.bid_deadline ? 'Extend deadline' : 'Set a deadline'}</Button><Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}>Close bidding now</Button></> : <Button size="sm" variant="outline" onClick={() => setDeadline(true)}>Reopen bidding</Button>}</div>}
    </section>
    {pending.length === 0 ? <div className="py-6 text-center space-y-2"><p>No bids yet.</p><p className="text-xs text-muted-foreground">Matching consultants were notified.</p>{!readOnly && !assigned && <div className="flex flex-wrap justify-center gap-2"><Button variant="outline" size="sm" onClick={onInvite}>Invite consultants</Button><Button variant="outline" size="sm" onClick={() => setDeadline(!open)}>Extend deadline</Button></div>}</div> : <>
      <div className="flex flex-wrap justify-between gap-3 items-center"><label className="flex gap-2 items-center text-sm"><Checkbox checked={shortlistOnly} onCheckedChange={v => setShortlistOnly(v === true)} />Shortlisted only</label>
        <div className="flex items-center gap-1"><Select value={sort} onValueChange={v => { setSort(v as ComparisonSort); setDescending(false); }}><SelectTrigger aria-label="Sort bids" className="w-44"><SelectValue /></SelectTrigger><SelectContent>{sorts.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select><Button size="icon" variant="ghost" aria-label={descending ? 'Sort ascending' : 'Sort descending'} onClick={() => setDescending(!descending)}>{descending ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></div>
      </div>
      {wide && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-start"><th className="text-start p-2">Consultant</th>{(['rate', 'total', 'timeline', 'rating', 'newest'] as ComparisonSort[]).map(s => <th key={s} className="text-start p-2"><Button variant="ghost" size="sm" onClick={() => sortBy(s)}>{sorts.find(x => x.value === s)?.label}</Button></th>)}<th className="text-start p-2">Estimated hours</th><th className="text-start p-2">Status</th></tr></thead><tbody>{bids.map(p => <Fragment key={p.id}><tr className="border-b border-border align-top"><td className="p-2 max-w-64">{consultant(p)}</td><td className="p-2">${p.proposed_rate}/hr</td><td className="p-2">${estimatedTotal(p).toLocaleString()}</td><td className="p-2">{p.timeline_days} days</td><td className="p-2">{p.consultant_rating}</td><td className="p-2 text-xs">{new Date(p.created_at).toLocaleDateString()}</td><td className="p-2">{p.estimated_hours}h</td><td className="p-2 max-w-48">{chips(p)}<Button variant="ghost" size="sm" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>Bid details<ChevronDown className="h-3 w-3 ms-1" /></Button></td></tr>{expanded === p.id && <tr><td colSpan={8}>{details(p)}</td></tr>}</Fragment>)}</tbody></table></div>}
      {!wide && <div className="space-y-3">{bids.map(p => <article key={p.id} className="rounded-2xl border border-border p-3 space-y-3">{consultant(p)}<dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-muted-foreground">Rate per hour</dt><dd>${p.proposed_rate}/hr</dd></div><div><dt className="text-muted-foreground">Estimated total</dt><dd>${estimatedTotal(p).toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Estimated hours</dt><dd>{p.estimated_hours}h</dd></div><div><dt className="text-muted-foreground">Timeline days</dt><dd>{p.timeline_days} days</dd></div></dl>{chips(p)}<Button variant="ghost" size="sm" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>Bid details<ChevronDown className="h-3 w-3 ms-1" /></Button>{expanded === p.id && details(p)}</article>)}</div>}
    </>}
    {questionError ? <p role="alert" className="text-destructive">{questionError.message}</p> : <BidQuestions questions={questions} readOnly={readOnly} />}
    <BidDeadlineDialog ticketId={ticketId} open={deadlineOpen} onOpenChange={setDeadlineOpen} reopen={reopen} hasDeadline={!!ticket.bid_deadline} />
    {counterBid && <BidCounterDialog bid={counterBid} hasCounter={!!counterFor(counterBid)} open onOpenChange={v => { if (!v) setCounterBid(null); }} />}
    {declineBid && <BidDeclineDialog id={declineBid} open onOpenChange={v => { if (!v) setDeclineBid(null); }} />}
    <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Close bidding now</AlertDialogTitle><AlertDialogDescription>Close bidding now?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button disabled={close.isPending} onClick={() => close.mutate(ticketId, { onSuccess: () => setCloseOpen(false), onError: reportError })}>Close bidding now</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!acceptBid} onOpenChange={v => { if (!v) setAcceptBid(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Accept bid</AlertDialogTitle><AlertDialogDescription>The other bidders will be told that another consultant was chosen.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button disabled={accept.isPending} onClick={() => { if (!acceptBid) return; accept.mutate({ proposalId: acceptBid.id, status: 'accepted' }, { onSuccess: () => { setAcceptBid(null); for (const key of ['client-bids', 'client-bid-summary']) void queryClient.invalidateQueries({ queryKey: [key] }); toast.success('Bid accepted!'); }, onError: reportError }); }}>Accept bid</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

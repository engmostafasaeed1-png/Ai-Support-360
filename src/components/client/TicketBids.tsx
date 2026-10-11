import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useTicketProposals, useRespondToProposal } from '@/hooks/useProposals';
import { useCriticalView } from '@/hooks/useCriticalService';
import { effectiveRate, formatPercent, surchargeApplies } from '@/lib/criticalService';
import { DollarSign, Clock, Calendar, Star, CheckCircle2, XCircle, Gavel, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

const statusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700', icon: Clock },
  accepted: { label: 'Accepted', className: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700', icon: XCircle },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground', icon: XCircle },
};

interface Props {
  ticketId: string;
}

export default function TicketBids({ ticketId }: Props) {
  const { data: proposals, isLoading } = useTicketProposals(ticketId);
  const respond = useRespondToProposal();
  const { data: critical } = useCriticalView(ticketId);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [clientNotes, setClientNotes] = useState('');

  const handleRespond = (proposalId: string, status: 'accepted' | 'rejected') => {
    respond.mutate(
      { proposalId, status, client_notes: clientNotes || undefined },
      {
        onSuccess: () => {
          toast.success(status === 'accepted' ? 'Bid accepted!' : 'Bid rejected.');
          setReplyTo(null);
          setClientNotes('');
        },
        onError: () => toast.error('Failed to respond.'),
      }
    );
  };

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  if (!proposals || proposals.length === 0) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-12 text-center">
          <Gavel className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No bids received yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Consultants will submit proposals for your ticket.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Gavel className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold text-foreground">{proposals.length} Bid{proposals.length !== 1 ? 's' : ''} Received</span>
      </div>
      {proposals.map((p: any) => {
        const config = statusConfig[p.status] || statusConfig.pending;
        const StatusIcon = config.icon;
        const total = p.proposed_rate * (p.estimated_hours || 0);
        // a critical request: the surcharge is added to the rate of a consultant who replied in time, when the client accepts the bid
        const criticalPercent = critical?.critical_response ? Number(critical.surcharge_percent ?? 0) : 0;
        const repliedInTime = surchargeApplies(critical, p.consultant_id);

        return (
          <Card key={p.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                  {(p.consultant_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-foreground text-sm">{p.consultant_name}</h4>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-0.5">
                          <Star className="w-3 h-3 text-amber-500" /> {p.consultant_rating || 0}
                        </span>
                        <span>({p.consultant_reviews || 0} reviews)</span>
                      </div>
                    </div>
                    <Badge variant="secondary" className={`text-[10px] gap-1 ${config.className}`}>
                      <StatusIcon className="w-3 h-3" /> {config.label}
                    </Badge>
                  </div>

                  {/* Bid details */}
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <DollarSign className="w-3.5 h-3.5 text-green-600" /> ${p.proposed_rate}/hr
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {p.estimated_hours || 0}h
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {p.timeline_days || 0} days
                    </span>
                    {total > 0 && (
                      <span className="font-semibold text-foreground">
                        Total: ${total.toLocaleString()}
                      </span>
                    )}
                  </div>

                  {p.status === 'pending' && criticalPercent > 0 && (
                    repliedInTime ? (
                      <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-800 dark:bg-green-950/30 dark:text-green-300" data-testid="bid-critical-in-time">
                        {`Replied in time. If you accept this bid, +${formatPercent(criticalPercent)} is added: $${effectiveRate(Number(p.proposed_rate), criticalPercent)}/hr instead of $${p.proposed_rate}/hr.`}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground" data-testid="bid-critical-late">
                        Replied after the critical reply window: no surcharge.
                      </p>
                    )
                  )}

                  {/* Cover letter */}
                  {p.cover_letter && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-3 bg-muted/30 rounded-lg p-2.5">
                      "{p.cover_letter}"
                    </p>
                  )}

                  {/* Client notes if already responded */}
                  {p.client_notes && (
                    <div className="flex items-start gap-1.5 mt-2 text-xs text-muted-foreground">
                      <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>Your note: "{p.client_notes}"</span>
                    </div>
                  )}

                  {/* Actions for pending bids */}
                  {p.status === 'pending' && (
                    <div className="mt-3">
                      {replyTo === p.id ? (
                        <div className="space-y-2">
                          <Textarea
                            placeholder="Add a note (optional)..."
                            value={clientNotes}
                            onChange={(e) => setClientNotes(e.target.value)}
                            className="min-h-[60px] text-xs"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="h-8 text-xs gradient-primary border-0"
                              onClick={() => handleRespond(p.id, 'accepted')}
                              disabled={respond.isPending}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 me-1" /> Accept Bid
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs text-destructive hover:bg-destructive/10"
                              onClick={() => handleRespond(p.id, 'rejected')}
                              disabled={respond.isPending}
                            >
                              <XCircle className="w-3.5 h-3.5 me-1" /> Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => { setReplyTo(null); setClientNotes(''); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-8 text-xs gradient-primary border-0"
                            onClick={() => handleRespond(p.id, 'accepted')}
                            disabled={respond.isPending}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 me-1" /> Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => handleRespond(p.id, 'rejected')}
                            disabled={respond.isPending}
                          >
                            <XCircle className="w-3.5 h-3.5 me-1" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => setReplyTo(p.id)}
                          >
                            <MessageSquare className="w-3.5 h-3.5 me-1" /> Add Note
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

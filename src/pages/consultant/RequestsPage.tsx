import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsultantMatchRequests, useRespondToMatch } from '@/hooks/useMatchRequests';
import { Check, X, Inbox, Clock, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useState } from 'react';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusBadge: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'Accepted', className: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

export default function RequestsPage() {
  const { t } = useTranslation();
  const { data: requests, isLoading } = useConsultantMatchRequests();
  const respond = useRespondToMatch();
  const [filter, setFilter] = useState<string>('all');

  const handleRespond = (requestId: string, status: 'accepted' | 'rejected') => {
    respond.mutate({ requestId, status }, {
      onSuccess: () => toast.success(status === 'accepted' ? 'Match accepted!' : 'Match declined.'),
      onError: () => toast.error('Failed to respond. Please try again.'),
    });
  };

  const filtered = (requests || []).filter(r => filter === 'all' || r.status === filter);
  const pendingCount = (requests || []).filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Match Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and respond to ticket match invitations.
          {pendingCount > 0 && <span className="text-amber-600 font-medium ms-1">({pendingCount} pending)</span>}
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {['all', 'pending', 'accepted', 'rejected'].map(s => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? 'default' : 'outline'}
            className={`text-xs rounded-full h-8 ${filter === s ? 'gradient-primary border-0' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No match requests found.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((req: any) => {
            const badge = statusBadge[req.status] || statusBadge.pending;
            return (
              <Card key={req.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{req.ticket_title}</h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                        <span>{req.sap_module}</span>
                        <span className="text-xs">•</span>
                        <span>{new Date(req.created_at).toLocaleDateString()}</span>
                      </div>
                      {req.message && (
                        <p className="text-xs text-muted-foreground mt-2 italic">"{req.message}"</p>
                      )}
                      {req.status === 'pending' && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                          <Clock className="w-3 h-3" />
                          Awaiting your response
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[req.urgency]}`}>
                          {req.urgency}
                        </Badge>
                        <Badge variant="secondary" className={`text-[10px] ${badge.className}`}>
                          {badge.label}
                        </Badge>
                      </div>
                      {req.status === 'pending' && (
                        <div className="flex items-center gap-2 mt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => handleRespond(req.id, 'rejected')}
                            disabled={respond.isPending}
                          >
                            <X className="w-3.5 h-3.5 me-1" /> Decline
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 text-xs gradient-primary border-0"
                            onClick={() => handleRespond(req.id, 'accepted')}
                            disabled={respond.isPending}
                          >
                            <Check className="w-3.5 h-3.5 me-1" /> Accept
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

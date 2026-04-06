import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsultantProposals } from '@/hooks/useProposals';
import { FileText, Clock, CheckCircle2, XCircle, Inbox, DollarSign, Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';

const statusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700', icon: Clock },
  accepted: { label: 'Accepted', className: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700', icon: XCircle },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground', icon: XCircle },
};

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export default function ProposalsPage() {
  const { t } = useTranslation();
  const { data: proposals, isLoading } = useConsultantProposals();
  const [filter, setFilter] = useState<string>('all');

  const filtered = (proposals || []).filter((p: any) => filter === 'all' || p.status === filter);
  const stats = {
    total: (proposals || []).length,
    pending: (proposals || []).filter((p: any) => p.status === 'pending').length,
    accepted: (proposals || []).filter((p: any) => p.status === 'accepted').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Proposals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track your submitted proposals and bids on open tickets.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Proposals</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.accepted}</p>
            <p className="text-xs text-muted-foreground">Accepted</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
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

      {/* Proposals List */}
      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No proposals found.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((proposal: any) => {
            const config = statusConfig[proposal.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            return (
              <Card key={proposal.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-accent shrink-0" />
                        <h3 className="font-semibold text-foreground truncate">{proposal.ticket_title}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[proposal.urgency]}`}>
                          {proposal.urgency}
                        </Badge>
                        <span>{proposal.sap_module}</span>
                        <span className="text-xs">•</span>
                        <span>{new Date(proposal.created_at).toLocaleDateString()}</span>
                      </div>
                      {proposal.cover_letter && (
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">"{proposal.cover_letter}"</p>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> ${proposal.proposed_rate}/hr
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {proposal.estimated_hours}h estimated
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {proposal.timeline_days} days
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant="secondary" className={`text-[10px] gap-1 ${config.className}`}>
                        <StatusIcon className="w-3 h-3" /> {config.label}
                      </Badge>
                      {proposal.client_notes && (
                        <p className="text-[10px] text-muted-foreground italic max-w-[200px] text-end">
                          Client: "{proposal.client_notes}"
                        </p>
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

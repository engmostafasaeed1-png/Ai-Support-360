import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Ticket, Link2, ExternalLink, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, Filter
} from 'lucide-react';
import { useClientTickets } from '@/hooks/useClientTickets';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Mock architecture references for tickets (in production, this would be a DB relation)
const ticketArchRefs: Record<string, { blueprint?: string; designDoc?: string; component?: string }> = {
  // These will match against real ticket IDs dynamically
};

const statusCfg: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  new: { label: 'New', color: 'bg-blue-500/10 text-blue-600', icon: Clock },
  open: { label: 'Open', color: 'bg-amber-500/10 text-amber-600', icon: AlertTriangle },
  in_progress: { label: 'In Progress', color: 'bg-primary/10 text-primary', icon: Clock },
  resolved: { label: 'Resolved', color: 'bg-emerald-500/10 text-emerald-600', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
  pending: { label: 'Pending', color: 'bg-orange-500/10 text-orange-600', icon: Clock },
  waiting_client: { label: 'Waiting', color: 'bg-yellow-500/10 text-yellow-600', icon: Clock },
};

export default function TicketReferences({ searchQuery }: { searchQuery: string }) {
  const { data: tickets, isLoading } = useClientTickets();
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('all');

  const filtered = (tickets || []).filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.sap_module?.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className="rounded-2xl border-border/50 animate-pulse">
            <CardContent className="p-5 h-24" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36 h-9 text-xs">
              <Filter className="w-3.5 h-3.5 mr-1" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="text-xs">{filtered.length} tickets</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Tickets linked to architecture documents & design decisions</p>
      </div>

      {filtered.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="py-12 text-center">
            <Ticket className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No tickets found</p>
            <p className="text-xs text-muted-foreground/70">Create tickets to link them to architecture documents</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(ticket => {
            const sc = statusCfg[ticket.status] || statusCfg.new;
            const StatusIcon = sc.icon;
            return (
              <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all cursor-pointer group"
                onClick={() => navigate(`/client/tickets/${ticket.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <Ticket className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] font-mono text-muted-foreground">{ticket.id.slice(0, 8)}</span>
                        <Badge variant="outline" className={`text-[9px] ${sc.color}`}>
                          <StatusIcon className="w-3 h-3 mr-0.5" />{sc.label}
                        </Badge>
                        {ticket.sap_module && (
                          <Badge variant="secondary" className="text-[9px]">{ticket.sap_module}</Badge>
                        )}
                        {ticket.urgency && (
                          <Badge variant="outline" className={`text-[9px] ${ticket.urgency === 'critical' ? 'bg-red-500/10 text-red-600' : ticket.urgency === 'high' ? 'bg-orange-500/10 text-orange-600' : ''}`}>
                            {ticket.urgency}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">{ticket.title}</p>
                      {ticket.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{ticket.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ticket.consultant && (
                        <Badge variant="outline" className="text-[9px]">{ticket.consultant}</Badge>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

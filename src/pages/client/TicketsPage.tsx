import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientTickets } from '@/hooks/useClientTickets';
import {
  Search, TicketPlus, Ticket, ChevronDown, ChevronUp,
  Clock, User, Calendar, Tag, Video, MessageSquare, Monitor,
  Globe, Brain, Gavel, Pencil, ArrowUpRight, Timer,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TicketDocuments from '@/components/client/TicketDocuments';
import { format, formatDistanceToNow } from 'date-fns';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  triaging: 'bg-indigo-100 text-indigo-700',
  under_review: 'bg-indigo-100 text-indigo-700',
  planning: 'bg-violet-100 text-violet-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-orange-100 text-orange-700',
  waiting_for_client: 'bg-amber-100 text-amber-700',
  waiting_for_vendor: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

const sessionIcons: Record<string, typeof Video> = {
  video: Video,
  chat: MessageSquare,
  screen_share: Monitor,
};

export default function TicketsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const { data: tickets, isLoading } = useClientTickets();
  const navigate = useNavigate();

  const filtered = (tickets || []).filter((t) => {
    const matchSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.sap_module.toLowerCase().includes(search.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statuses = ['all', 'new', 'under_review', 'matched', 'in_progress', 'waiting_for_client', 'resolved', 'closed'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">Track all your support requests with full details.</p>
        </div>
        <Link to="/client/new-request">
          <Button className="gradient-primary border-0" size="sm">
            <TicketPlus className="w-4 h-4 me-1" /> New Request
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              className={`text-xs rounded-full h-8 ${statusFilter === s ? 'gradient-primary border-0' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <Ticket className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No tickets found.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((ticket) => {
            const isExpanded = expandedTicket === ticket.id;
            const SessionIcon = sessionIcons[ticket.preferred_session_type || ''] || Video;

            return (
              <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all overflow-hidden">
                <CardContent className="p-4">
                  {/* Header Row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <Link to={`/client/tickets/${ticket.id}`} className="font-semibold text-foreground hover:text-primary transition-colors line-clamp-1">
                        {ticket.title}
                      </Link>

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1.5">
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3" /> {ticket.sap_module}
                        </span>
                        {ticket.consultant && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {ticket.consultant}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {format(new Date(ticket.created_at), 'MMM d, yyyy')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(ticket.updated_at || ticket.created_at), { addSuffix: true })}
                        </span>
                      </div>

                      {/* Badges row */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
                          {ticket.urgency}
                        </Badge>
                        <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status] || 'bg-muted text-muted-foreground'}`}>
                          {ticket.status.replace(/_/g, ' ')}
                        </Badge>
                        {ticket.preferred_session_type && (
                          <Badge variant="outline" className="text-[10px] gap-0.5">
                            <SessionIcon className="w-2.5 h-2.5" />
                            {ticket.preferred_session_type.replace(/_/g, ' ')}
                          </Badge>
                        )}
                        {ticket.preferred_language && (
                          <Badge variant="outline" className="text-[10px] gap-0.5">
                            <Globe className="w-2.5 h-2.5" />
                            {ticket.preferred_language === 'ar' ? 'Arabic' : 'English'}
                          </Badge>
                        )}
                        {ticket.open_for_bids && (
                          <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent gap-0.5">
                            <Gavel className="w-2.5 h-2.5" /> Bids Open
                          </Badge>
                        )}
                        {ticket.ai_suggested_category && (
                          <Badge variant="outline" className="text-[10px] gap-0.5">
                            <Brain className="w-2.5 h-2.5" /> {ticket.ai_suggested_category}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.preventDefault(); navigate(`/client/tickets/${ticket.id}`); }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.preventDefault(); setExpandedTicket(isExpanded ? null : ticket.id); }}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/20 pt-3 space-y-3">
                    {/* Description */}
                    {ticket.description && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4">{ticket.description}</p>
                      </div>
                    )}

                    {/* Detail Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {ticket.sla_deadline && (
                        <DetailMini icon={Timer} label="SLA Deadline" value={format(new Date(ticket.sla_deadline), 'MMM d, h:mm a')} />
                      )}
                      {ticket.ai_suggested_priority && (
                        <DetailMini icon={Brain} label="AI Priority" value={ticket.ai_suggested_priority} />
                      )}
                      {ticket.consultant && (
                        <DetailMini icon={User} label="Consultant" value={ticket.consultant} />
                      )}
                      <DetailMini icon={Calendar} label="Created" value={format(new Date(ticket.created_at), 'MMM d, yyyy')} />
                    </div>

                    {/* Documents */}
                    <TicketDocuments ticketId={ticket.id} />

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" asChild>
                        <Link to={`/client/tickets/${ticket.id}`}>
                          <ArrowUpRight className="w-3 h-3" /> View Full Details
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => navigate(`/client/tickets/${ticket.id}`)}>
                        <Pencil className="w-3 h-3" /> Edit Ticket
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function DetailMini({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-2">
      <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
        <Icon className="w-3 h-3" />
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs font-medium text-foreground truncate">{value}</p>
    </div>
  );
}

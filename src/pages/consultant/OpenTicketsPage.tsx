import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Search, Gavel, Inbox, Tag, Clock, Building2, Globe, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import SubmitProposalModal from '@/components/consultant/SubmitProposalModal';
import { formatDistanceToNow } from 'date-fns';

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
      const { data, error } = await supabase
        .from('tickets')
        .select('id, title, description, sap_module, urgency, status, created_at, preferred_session_type, preferred_language, open_for_bids, opened_for_bids_at')
        // the database decides what this consultant may see: tickets open for bids and tickets they were invited to
        .in('status', ['new', 'under_review'])
        .is('consultant_id', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export default function OpenTicketsPage() {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const { data: tickets, isLoading } = useOpenTickets();

  const modules = ['all', ...new Set((tickets || []).map(t => t.sap_module).filter(Boolean))];

  const filtered = (tickets || []).filter(t => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
      t.sap_module.toLowerCase().includes(search.toLowerCase());
    const matchModule = moduleFilter === 'all' || t.sap_module === moduleFilter;
    return matchSearch && matchModule;
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Gavel className="w-6 h-6 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Open Tickets</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Browse open tickets and submit your bids.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{(tickets || []).length}</p>
            <p className="text-xs text-muted-foreground">Open Tickets</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-orange-600">
              {(tickets || []).filter(t => t.urgency === 'high' || t.urgency === 'critical').length}
            </p>
            <p className="text-xs text-muted-foreground">High Priority</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-accent">{modules.length - 1}</p>
            <p className="text-xs text-muted-foreground">SAP Modules</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 rounded-xl h-10" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {modules.map(m => (
            <Button
              key={m}
              size="sm"
              variant={moduleFilter === m ? 'default' : 'outline'}
              className={`text-xs rounded-full h-8 ${moduleFilter === m ? 'gradient-primary border-0' : ''}`}
              onClick={() => setModuleFilter(m)}
            >
              {m === 'all' ? 'All Modules' : m}
            </Button>
          ))}
        </div>
      </div>

      {/* Ticket List */}
      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No open tickets match your search.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map(ticket => (
            <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all cursor-pointer">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Link to={`/consultant/tickets/${ticket.id}`} className="hover:underline">
                      <h3 className="font-semibold text-foreground flex items-center gap-1.5">
                        {ticket.title}
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </h3>
                    </Link>
                    {ticket.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-2">
                      <span className="flex items-center gap-1">
                        <Tag className="w-3 h-3" /> {ticket.sap_module}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                      </span>
                      {ticket.preferred_session_type && (
                        <span className="capitalize">{ticket.preferred_session_type.replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[9px] bg-accent/10 text-accent gap-1">
                        <Globe className="w-2.5 h-2.5" /> {ticket.open_for_bids ? 'Accepting Bids' : 'Private invitation'}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency || 'medium']}`}>
                        {ticket.urgency}
                      </Badge>
                    </div>
                    <SubmitProposalModal ticketId={ticket.id} ticketTitle={ticket.title} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mockClientTickets } from '@/data/clientMockData';
import { Search, ArrowUpRight, Clock, TicketPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  under_review: 'bg-indigo-100 text-indigo-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_for_client: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

export default function TicketsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = mockClientTickets.filter((t) => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) || t.sap_module.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statuses = ['all', 'new', 'under_review', 'matched', 'in_progress', 'resolved'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">Track all your support requests.</p>
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
        {filtered.map((ticket) => (
          <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{ticket.title}</h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                    <span>{ticket.sap_module}</span>
                    {ticket.consultant && <><span className="text-xs">•</span><span>{ticket.consultant}</span></>}
                    <span className="text-xs">•</span>
                    <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>{ticket.urgency}</Badge>
                  <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>{ticket.status.replace(/_/g, ' ')}</Badge>
                  <Button variant="ghost" size="icon"><ArrowUpRight className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

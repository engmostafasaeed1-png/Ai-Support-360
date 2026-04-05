import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mockCases } from '@/data/consultantMockData';
import { Search, Filter, ArrowUpRight, Clock } from 'lucide-react';
import { useState } from 'react';

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

export default function CasesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = mockCases.filter((c) => {
    const matchSearch = c.title.toLowerCase().includes(search.toLowerCase()) || c.client.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statuses = ['all', 'new', 'matched', 'in_progress', 'resolved', 'closed'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Case Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Track and manage your assigned support tickets.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search cases..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9 rounded-xl h-10"
          />
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
              {s === 'all' ? 'All' : s.replace('_', ' ')}
            </Button>
          ))}
        </div>
      </div>

      {/* Cases List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <Filter className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No cases match your filters.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((ticket) => {
            const slaTime = ticket.sla_deadline ? new Date(ticket.sla_deadline) : null;
            const isOverdue = slaTime && slaTime < new Date() && ticket.status !== 'resolved' && ticket.status !== 'closed';

            return (
              <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-foreground truncate">{ticket.title}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{ticket.client}</span>
                        <span className="text-xs">•</span>
                        <span>{ticket.sap_module}</span>
                        <span className="text-xs">•</span>
                        <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                      </div>
                      {slaTime && (
                        <div className={`flex items-center gap-1 mt-2 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                          <Clock className="w-3 h-3" />
                          SLA: {slaTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {isOverdue && ' (Overdue)'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
                        {ticket.urgency}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>
                        {ticket.status.replace(/_/g, ' ')}
                      </Badge>
                      <Button variant="ghost" size="icon">
                        <ArrowUpRight className="w-4 h-4" />
                      </Button>
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

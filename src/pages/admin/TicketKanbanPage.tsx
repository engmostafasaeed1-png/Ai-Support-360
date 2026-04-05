import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { kanbanTickets } from '@/data/adminMockData';

const urgencyColors: Record<string, string> = {
  low: 'bg-green-500/10 text-green-600 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
};

const columns = [
  { key: 'new' as const, label: 'New', color: 'bg-accent' },
  { key: 'under_review' as const, label: 'Under Review', color: 'bg-yellow-500' },
  { key: 'matched' as const, label: 'Matched', color: 'bg-purple-500' },
  { key: 'in_progress' as const, label: 'In Progress', color: 'bg-green-500' },
  { key: 'resolved' as const, label: 'Resolved', color: 'bg-muted-foreground' },
];

export default function TicketKanbanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ticket Board</h1>
        <p className="text-sm text-muted-foreground">Drag-and-drop ticket management</p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const tickets = kanbanTickets[col.key];
          return (
            <div key={col.key} className="min-w-[280px] flex-shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <h3 className="font-semibold text-sm text-foreground">{col.label}</h3>
                <Badge variant="secondary" className="text-[10px] ms-auto">{tickets.length}</Badge>
              </div>
              <div className="space-y-3">
                {tickets.map((ticket) => (
                  <Card
                    key={ticket.id}
                    className="border-border/50 hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
                        <Badge variant="outline" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
                          {ticket.urgency}
                        </Badge>
                      </div>
                      <h4 className="text-sm font-medium text-foreground mb-2 leading-tight">{ticket.title}</h4>
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-[10px]">{ticket.module}</Badge>
                        <span className="text-[10px] text-muted-foreground">{ticket.created}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{ticket.client}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

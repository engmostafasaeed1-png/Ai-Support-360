import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminTickets } from '@/hooks/useAdminData';

const urgencyColors: Record<string, string> = {
  low: 'bg-green-500/10 text-green-600 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
};

const columns = [
  { key: 'new' as const, labelKey: 'ticket_board.new', color: 'bg-accent' },
  { key: 'under_review' as const, labelKey: 'ticket_board.under_review', color: 'bg-yellow-500' },
  { key: 'matched' as const, labelKey: 'ticket_board.matched', color: 'bg-purple-500' },
  { key: 'in_progress' as const, labelKey: 'ticket_board.in_progress', color: 'bg-green-500' },
  { key: 'resolved' as const, labelKey: 'ticket_board.resolved', color: 'bg-muted-foreground' },
];

export default function TicketKanbanPage() {
  const { t } = useTranslation();
  const { data: kanbanTickets, isLoading } = useAdminTickets();

  const ticketData = kanbanTickets || { new: [], under_review: [], matched: [], in_progress: [], waiting_for_client: [], resolved: [], closed: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('ticket_board.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('ticket_board.subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.key} className="min-w-[280px] flex-shrink-0 space-y-3">
              <Skeleton className="h-6 w-32" />
              {[1, 2].map(i => <Skeleton key={i} className="h-32" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => {
            const tickets = (ticketData as any)[col.key] || [];
            return (
              <div key={col.key} className="min-w-[280px] flex-shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                  <h3 className="font-semibold text-sm text-foreground">{t(col.labelKey)}</h3>
                  <Badge variant="secondary" className="text-[10px] ms-auto">{tickets.length}</Badge>
                </div>
                <div className="space-y-3">
                  {tickets.map((ticket: any) => (
                    <Card key={ticket.id} className="border-border/50 hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
                          <Badge variant="outline" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>{ticket.urgency}</Badge>
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
      )}
    </div>
  );
}

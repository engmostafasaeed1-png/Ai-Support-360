import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type NextStatus = 'in_progress' | 'waiting_for_client' | 'resolved';

interface Props {
  ticketId: string;
  status: string | null;
}

const actions: Record<string, { to: NextStatus; label: string; icon: typeof Play; variant: 'default' | 'outline' }[]> = {
  matched: [{ to: 'in_progress', label: 'Start work', icon: Play, variant: 'default' }],
  in_progress: [
    { to: 'waiting_for_client', label: 'Hand back to client', icon: Clock, variant: 'outline' },
    { to: 'resolved', label: 'Mark as resolved', icon: CheckCircle2, variant: 'default' },
  ],
  waiting_for_client: [
    { to: 'in_progress', label: 'Resume work', icon: Play, variant: 'default' },
    { to: 'resolved', label: 'Mark as resolved', icon: CheckCircle2, variant: 'outline' },
  ],
};

const doneMessages: Record<NextStatus, string> = {
  in_progress: 'Work started. The client has been notified.',
  waiting_for_client: 'Handed back to the client. They have been notified.',
  resolved: 'Marked as resolved. The client has been notified.',
};

export default function TicketStatusActions({ ticketId, status }: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<NextStatus | null>(null);
  const available = actions[status || ''] ?? [];

  if (available.length === 0) return null;

  const change = async (to: NextStatus) => {
    setBusy(to);
    const { error } = await supabase.rpc('consultant_set_ticket_status', { _ticket_id: ticketId, _status: to });
    setBusy(null);
    if (error) {
      toast.error(error.message || 'The status could not be changed');
      return;
    }
    toast.success(doneMessages[to]);
    queryClient.invalidateQueries({ queryKey: ['case-detail', ticketId] });
    queryClient.invalidateQueries({ queryKey: ['consultant-cases'] });
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold flex-1 min-w-[160px]">Case status</p>
        {available.map((a) => {
          const Icon = a.icon;
          return (
            <Button key={a.to} size="sm" variant={a.variant} className="gap-1.5 text-xs" disabled={busy !== null} onClick={() => change(a.to)}>
              {busy === a.to ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              {a.label}
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}

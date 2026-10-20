import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import ConsultantLocation from '@/components/consultant/ConsultantLocation';

interface Props {
  ticketId: string;
  clientId: string;
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-muted text-muted-foreground',
};

export default function TicketMatchRequests({ ticketId, clientId }: Props) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ['current-user-id-match-requests'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  const { data: requests, isLoading } = useQuery({
    queryKey: ['ticket-match-requests', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_match_requests')
        .select('id, consultant_id, status, created_at, responded_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      const names = new Map<string, string>();
      const places = new Map<string, { city: string | null; country: string | null }>();
      const consultantIds = [...new Set(rows.map((r) => r.consultant_id))];
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase.from('consultants').select('id, user_id, city, country').in('id', consultantIds);
        (consultants ?? []).forEach((c: any) => places.set(c.id, { city: c.city ?? null, country: c.country ?? null }));
        const userIds = (consultants ?? []).map((c) => c.user_id);
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profile_directory').select('user_id, display_name').in('user_id', userIds);
          const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name || 'Consultant']));
          (consultants ?? []).forEach((c) => names.set(c.id, byUser.get(c.user_id) || 'Consultant'));
        }
      }
      return rows.map((r) => ({ ...r, consultant_name: names.get(r.consultant_id) || 'Consultant', city: places.get(r.consultant_id)?.city ?? null, country: places.get(r.consultant_id)?.country ?? null }));
    },
    enabled: !!ticketId,
  });

  const withdraw = async (id: string) => {
    setBusyId(id);
    const { data, error } = await supabase
      .from('ticket_match_requests')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .select('id');
    setBusyId(null);
    if (error || !data || data.length === 0) {
      toast.error(error?.message || 'The request could not be withdrawn');
      return;
    }
    toast.success('Request withdrawn. The consultant has been told.');
    queryClient.invalidateQueries({ queryKey: ['ticket-match-requests', ticketId] });
  };

  if (isLoading) return <Skeleton className="h-16 rounded-2xl" />;
  if (!requests || requests.length === 0) return null;

  const isOwner = !!me && me === clientId;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" /> Sent match requests
        </p>
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border/40 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.consultant_name}</p>
                <ConsultantLocation audience="client" city={r.city} country={r.country} className="text-[11px] text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground">Sent {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</p>
              </div>
              <Badge variant="secondary" className={`text-[10px] capitalize ${statusStyles[r.status] || ''}`}>{r.status}</Badge>
              {isOwner && r.status === 'pending' && (
                <Button size="sm" variant="outline" className="gap-1 text-xs" disabled={busyId === r.id} onClick={() => withdraw(r.id)}>
                  {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Withdraw
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

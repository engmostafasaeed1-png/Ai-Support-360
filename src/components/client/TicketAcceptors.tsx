import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientMatchAcceptors } from '@/hooks/useMatchRequests';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockAcceptors } from '@/data/matchRequestMockData';
import { supabase } from '@/integrations/supabase/client';
import { Star, Brain, CheckCircle2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  ticketId: string;
  currentConsultantId?: string | null;
}

export default function TicketAcceptors({ ticketId, currentConsultantId }: Props) {
  const { isGuest } = useGuestMode();
  const { data: acceptors, isLoading } = useClientMatchAcceptors(ticketId);

  const list = isGuest ? mockAcceptors : (acceptors || []);

  const handleChoose = async (consultantId: string, name: string) => {
    if (isGuest) {
      toast.success(`${name} assigned to your ticket! (Demo)`);
      return;
    }
    const { error } = await supabase
      .from('tickets')
      .update({ consultant_id: consultantId, status: 'in_progress' as any })
      .eq('id', ticketId);
    if (error) {
      toast.error('Failed to assign consultant.');
    } else {
      toast.success(`${name} has been assigned to your ticket!`);
    }
  };

  if (!isLoading && list.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Available Consultants</h3>
        <Badge variant="secondary" className="text-[10px]">{list.length} accepted</Badge>
      </div>

      {isLoading ? (
        [1, 2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
      ) : (
        list.map((c: any) => {
          const isAssigned = currentConsultantId === c.consultant_id;
          return (
            <Card key={c.request_id} className={`rounded-xl border-border/50 ${isAssigned ? 'ring-2 ring-primary' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                    {c.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">{c.name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {c.rating} ({c.total_reviews})</span>
                      <span className="flex items-center gap-1"><Brain className="w-3 h-3 text-accent" /> {c.ai_score}</span>
                      <span>${c.hourly_rate}/hr</span>
                    </div>
                    {c.modules?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.modules.slice(0, 3).map((m: string) => (
                          <Badge key={m} variant="secondary" className="text-[9px]">{m}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isAssigned ? (
                      <Badge className="bg-green-100 text-green-700 gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Assigned
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        className="gradient-primary border-0 text-xs h-8"
                        onClick={() => handleChoose(c.consultant_id, c.name)}
                      >
                        Choose
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

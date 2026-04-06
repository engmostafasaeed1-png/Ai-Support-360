import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, AlertTriangle, Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useRespondToMatch } from '@/hooks/useMatchRequests';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { toast } from 'sonner';

interface MatchPopupData {
  id: string;
  ticket_title: string;
  sap_module: string;
  urgency: string;
  message?: string;
}

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export default function MatchRequestPopup() {
  const [popup, setPopup] = useState<MatchPopupData | null>(null);
  const respond = useRespondToMatch();
  const { isGuest } = useGuestMode();

  useEffect(() => {
    if (isGuest) return;

    let consultantId: string | null = null;

    const setup = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: c } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!c) return;
      consultantId = c.id;

      const channel = supabase
        .channel('match-popup')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_match_requests',
          filter: `consultant_id=eq.${consultantId}`,
        }, async (payload) => {
          const row = payload.new as any;
          // Fetch ticket details
          const { data: ticket } = await supabase.from('tickets').select('title, sap_module, urgency').eq('id', row.ticket_id).maybeSingle();
          setPopup({
            id: row.id,
            ticket_title: ticket?.title || 'New Ticket',
            sap_module: ticket?.sap_module || '',
            urgency: ticket?.urgency || 'medium',
            message: row.message,
          });
        })
        .subscribe();

      return () => { channel.unsubscribe(); };
    };

    const cleanup = setup();
    return () => { cleanup.then(fn => fn?.()); };
  }, [isGuest]);

  const handleRespond = (status: 'accepted' | 'rejected') => {
    if (!popup) return;
    respond.mutate({ requestId: popup.id, status }, {
      onSuccess: () => {
        toast.success(status === 'accepted' ? 'Match accepted!' : 'Match declined.');
        setPopup(null);
      },
      onError: () => toast.error('Failed to respond.'),
    });
  };

  return (
    <Dialog open={!!popup} onOpenChange={(open) => !open && setPopup(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-primary-foreground" />
            </div>
            <DialogTitle className="text-lg">New Match Request</DialogTitle>
          </div>
          <DialogDescription>
            You've been matched to a support ticket. Review the details and respond.
          </DialogDescription>
        </DialogHeader>

        {popup && (
          <div className="space-y-3 py-2">
            <div>
              <p className="font-semibold text-foreground">{popup.ticket_title}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px]">{popup.sap_module}</Badge>
                <Badge variant="secondary" className={`text-[10px] ${urgencyColors[popup.urgency]}`}>
                  {popup.urgency}
                </Badge>
              </div>
            </div>
            {popup.message && (
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground italic">"{popup.message}"</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => handleRespond('rejected')}
            disabled={respond.isPending}
          >
            <X className="w-4 h-4 me-1" /> Decline
          </Button>
          <Button
            className="gradient-primary border-0"
            onClick={() => handleRespond('accepted')}
            disabled={respond.isPending}
          >
            <Check className="w-4 h-4 me-1" /> Accept Match
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

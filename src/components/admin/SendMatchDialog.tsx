import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdminSendMatch } from '@/hooks/useMatchRequests';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Send, Brain, Star } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  ticketTitle: string;
  sapModule: string;
}

export default function SendMatchDialog({ open, onOpenChange, ticketId, ticketTitle, sapModule }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const sendMatch = useAdminSendMatch();
  const { isGuest } = useGuestMode();

  // Fetch consultants matching the SAP module
  const { data: suggestedConsultants, isLoading } = useQuery({
    queryKey: ['suggested-consultants', ticketId, sapModule],
    queryFn: async () => {
      // Get consultants with matching skills
      const { data: skills } = await supabase
        .from('consultant_skills')
        .select('consultant_id')
        .ilike('sap_module', `%${sapModule.replace('SAP ', '')}%`);

      const consultantIds = [...new Set((skills || []).map(s => s.consultant_id))];
      if (!consultantIds.length) return [];

      const { data: consultants } = await supabase
        .from('consultants')
        .select(`id, hourly_rate, currency, rating, ai_skills_score, verification_status,
          profiles:user_id (display_name, avatar_url)`)
        .in('id', consultantIds)
        .eq('verification_status', 'verified');

      // Check which already have requests for this ticket
      const { data: existing } = await supabase
        .from('ticket_match_requests')
        .select('consultant_id')
        .eq('ticket_id', ticketId);
      const alreadySent = new Set((existing || []).map((e: any) => e.consultant_id));

      return (consultants || []).map((c: any) => ({
        id: c.id,
        name: c.profiles?.display_name || 'Unknown',
        avatar_url: c.profiles?.avatar_url,
        hourly_rate: c.hourly_rate || 0,
        currency: c.currency || 'USD',
        rating: c.rating || 0,
        ai_score: c.ai_skills_score || 0,
        already_sent: alreadySent.has(c.id),
      }));
    },
    enabled: open && !isGuest,
    placeholderData: isGuest ? [
      { id: 'c1', name: 'Ahmed Al-Rashid', avatar_url: null, hourly_rate: 150, currency: 'USD', rating: 4.9, ai_score: 94.5, already_sent: false },
      { id: 'c2', name: 'Sara Khalil', avatar_url: null, hourly_rate: 120, currency: 'USD', rating: 4.7, ai_score: 88, already_sent: false },
      { id: 'c3', name: 'Omar Mansour', avatar_url: null, hourly_rate: 130, currency: 'USD', rating: 4.8, ai_score: 91, already_sent: true },
    ] : undefined,
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleSend = async () => {
    if (isGuest) {
      toast.success(`Match requests sent to ${selected.size} consultant(s)! (Demo)`);
      setSelected(new Set());
      setMessage('');
      onOpenChange(false);
      return;
    }

    let sent = 0;
    for (const consultantId of selected) {
      try {
        await sendMatch.mutateAsync({ ticketId, consultantId, message: message || undefined });
        sent++;
      } catch {}
    }
    if (sent > 0) {
      toast.success(`Match requests sent to ${sent} consultant(s)!`);
      setSelected(new Set());
      setMessage('');
      onOpenChange(false);
    } else {
      toast.error('Failed to send match requests.');
    }
  };

  const available = (suggestedConsultants || []).filter((c: any) => !c.already_sent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send Match Requests</DialogTitle>
          <DialogDescription>
            AI-suggested consultants for "<span className="font-medium">{ticketTitle}</span>" ({sapModule}).
            Select consultants and send invitations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isLoading ? (
            [1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No matching consultants available.</p>
          ) : (
            available.map((c: any) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  selected.has(c.id) ? 'border-primary bg-primary/5' : 'border-border/50 hover:bg-muted/30'
                }`}
                onClick={() => toggle(c.id)}
              >
                <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                  {c.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {c.rating}</span>
                    <span className="flex items-center gap-1"><Brain className="w-3 h-3 text-accent" /> {c.ai_score}</span>
                    <span>${c.hourly_rate}/hr</span>
                  </div>
                </div>
              </div>
            ))
          )}

          {(suggestedConsultants || []).some((c: any) => c.already_sent) && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Already invited:</p>
              <div className="flex flex-wrap gap-2">
                {(suggestedConsultants || []).filter((c: any) => c.already_sent).map((c: any) => (
                  <Badge key={c.id} variant="secondary" className="text-[10px]">{c.name}</Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Optional message to consultants</label>
            <Textarea
              placeholder="e.g. Urgent — client needs help with month-end close..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="gradient-primary border-0"
            disabled={selected.size === 0 || sendMatch.isPending}
            onClick={handleSend}
          >
            <Send className="w-4 h-4 me-1" /> Send to {selected.size} Consultant{selected.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Gavel, Globe, ShieldCheck, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTicketProposals } from '@/hooks/useProposals';

interface Props {
  ticketId: string;
  ticketTitle: string;
  isOpenForBids: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RequestBidDialog({ ticketId, ticketTitle, isOpenForBids, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const { data: proposals } = useTicketProposals(ticketId);

  const pendingBids = (proposals || []).filter((p: any) => p.status === 'pending').length;
  const totalBids = (proposals || []).length;

  const handleOpenForBids = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('tickets')
      .update({
        open_for_bids: true,
        opened_for_bids_at: new Date().toISOString(),
      } as any)
      .eq('id', ticketId);
    setSaving(false);
    if (error) {
      toast.error('Failed to open ticket for bids');
    } else {
      toast.success('Ticket is now open for bids! Consultants can see and bid on it.');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticketId] });
      onOpenChange(false);
    }
  };

  const handleCloseBids = async () => {
    setClosing(true);
    const { error } = await supabase
      .from('tickets')
      .update({ open_for_bids: false } as any)
      .eq('id', ticketId);
    setClosing(false);
    if (error) {
      toast.error('Failed to close bidding');
    } else {
      toast.success('Bidding closed for this ticket.');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticketId] });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="w-5 h-5 text-accent" />
            Request Bids
          </DialogTitle>
          <DialogDescription className="text-sm">
            Open your ticket for consultants to submit competitive proposals
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticket info */}
          <Card className="rounded-xl border-border/50 bg-muted/30">
            <CardContent className="p-3">
              <p className="text-sm font-semibold text-foreground line-clamp-1">{ticketTitle}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <Badge variant="secondary" className={`text-[9px] ${isOpenForBids ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                  {isOpenForBids ? '🟢 Open for Bids' : '⚫ Closed'}
                </Badge>
                {totalBids > 0 && (
                  <Badge variant="secondary" className="text-[9px]">
                    {totalBids} bid{totalBids !== 1 ? 's' : ''} received
                  </Badge>
                )}
                {pendingBids > 0 && (
                  <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-600">
                    {pendingBids} pending
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {!isOpenForBids ? (
            <>
              {/* What happens when you open for bids */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">When you open for bids:</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Globe className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">Your ticket becomes visible to all verified consultants on the platform</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Gavel className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">Consultants can submit proposals with their rate, timeline, and approach</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">You review, compare, and accept the best bid — no obligation until you choose</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">You can close bidding anytime and choose from received proposals</p>
                  </div>
                </div>
              </div>

              <Button
                className="w-full gradient-primary border-0 gap-2"
                onClick={handleOpenForBids}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gavel className="w-4 h-4" />}
                Open Ticket for Bids
              </Button>
            </>
          ) : (
            <>
              {/* Already open — show status and close option */}
              <Card className="rounded-xl border-accent/20 bg-accent/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-accent" />
                    <p className="text-sm font-semibold text-accent">Bidding is Active</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Consultants can currently view this ticket and submit proposals. 
                    You can review incoming bids in the "Bids" tab.
                  </p>
                </CardContent>
              </Card>

              {pendingBids > 0 && (
                <div className="flex items-start gap-2 bg-amber-500/10 rounded-lg p-2.5 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    You have {pendingBids} pending bid{pendingBids !== 1 ? 's' : ''} to review. Closing bidding won't affect received bids.
                  </p>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleCloseBids}
                disabled={closing}
              >
                {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gavel className="w-4 h-4" />}
                Close Bidding
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

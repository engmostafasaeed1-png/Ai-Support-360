import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { declineReasons, contactHelp } from '@/lib/clientBidding';
import { useDeclineBid } from '@/hooks/useClientBids';
import { toast } from 'sonner';
export default function BidDeclineDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState<string>(declineReasons[0]);
  const [text, setText] = useState('');
  const decline = useDeclineBid();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Decline</DialogTitle></DialogHeader>
    <Select value={reason} onValueChange={setReason}><SelectTrigger aria-label="Decline reason"><SelectValue /></SelectTrigger><SelectContent>{declineReasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
    <Label htmlFor="decline-text">Reason (optional)</Label><Textarea id="decline-text" maxLength={300} value={text} onChange={e => setText(e.target.value)} /><p className="text-xs text-muted-foreground">{contactHelp}</p>
    <Button variant="destructive" disabled={decline.isPending} onClick={() => decline.mutate({ id, reason, text }, { onSuccess: () => { toast.success('Bid declined.'); onOpenChange(false); }, onError: (e: any) => toast.error(e.message) })}>Decline</Button>
  </DialogContent></Dialog>;
}

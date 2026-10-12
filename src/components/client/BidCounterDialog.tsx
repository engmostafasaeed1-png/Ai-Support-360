import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCounterOffer } from '@/hooks/useClientBids';
import { contactHelp, counterProblem } from '@/lib/clientBidding';
import { toast } from 'sonner';

export default function BidCounterDialog({ bid, hasCounter, open, onOpenChange }: { bid: any; hasCounter: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rate, setRate] = useState(String(bid.proposed_rate));
  const [hours, setHours] = useState(String(bid.estimated_hours));
  const [days, setDays] = useState(String(bid.timeline_days));
  const [message, setMessage] = useState('');
  const send = useCounterOffer();
  useEffect(() => { if (open) { setRate(String(bid.proposed_rate)); setHours(String(bid.estimated_hours)); setDays(String(bid.timeline_days)); setMessage(''); } }, [open, bid.id, bid.proposed_rate, bid.estimated_hours, bid.timeline_days]);
  const input = { proposalId: bid.id, rate: Number(rate), hours: Number(hours), days: Number(days), message };
  const problem = counterProblem(input, hasCounter);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>Make a counter-offer</DialogTitle></DialogHeader>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (problem) { toast.error(problem); return; } send.mutate(input, { onSuccess: () => { toast.success('Counter-offer sent.'); onOpenChange(false); }, onError: (e: any) => toast.error(e.message) }); }}>
      <Label htmlFor="counter-rate">Rate per hour</Label><Input id="counter-rate" type="number" min="0.01" step="any" value={rate} onChange={e => setRate(e.target.value)} />
      <Label htmlFor="counter-hours">Estimated hours</Label><Input id="counter-hours" type="number" min="0.01" step="any" value={hours} onChange={e => setHours(e.target.value)} />
      <Label htmlFor="counter-days">Timeline days</Label><Input id="counter-days" type="number" min="1" step="1" value={days} onChange={e => setDays(e.target.value)} />
      <Label htmlFor="counter-message">Message</Label><Textarea id="counter-message" value={message} maxLength={1000} onChange={e => setMessage(e.target.value)} />
      <p className="text-xs text-muted-foreground">{contactHelp}</p>
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
      <Button type="submit" disabled={send.isPending || !!problem}>Send counter-offer</Button>
    </form>
  </DialogContent></Dialog>;
}

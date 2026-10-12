import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { deadlineOptions, type DeadlineOption } from '@/lib/clientBidding';
import { useSetDeadline } from '@/hooks/useClientBids';
import { toast } from 'sonner';

export default function BidDeadlineDialog({ ticketId, open, onOpenChange, reopen = false, hasDeadline = false }: { ticketId: string; open: boolean; onOpenChange: (open: boolean) => void; reopen?: boolean; hasDeadline?: boolean }) {
  const [option, setOption] = useState<DeadlineOption>('72');
  const save = useSetDeadline();
  const title = reopen ? 'Reopen bidding' : hasDeadline ? 'Extend deadline' : 'Set a deadline';
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    <Select value={option} onValueChange={v => setOption(v as DeadlineOption)}><SelectTrigger aria-label="Bidding deadline"><SelectValue /></SelectTrigger><SelectContent>{deadlineOptions.filter(o => reopen || o.value !== 'none').map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
    <Button disabled={save.isPending} onClick={() => save.mutate({ ticketId, option, reopen }, { onSuccess: () => onOpenChange(false), onError: (e: any) => toast.error(e.message) })}>{title}</Button>
  </DialogContent></Dialog>;
}

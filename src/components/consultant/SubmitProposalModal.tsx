import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useSubmitProposal } from '@/hooks/useProposals';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

interface SubmitProposalModalProps {
  ticketId: string;
  ticketTitle: string;
  trigger?: React.ReactNode;
}

export default function SubmitProposalModal({ ticketId, ticketTitle, trigger }: SubmitProposalModalProps) {
  const [open, setOpen] = useState(false);
  const submit = useSubmitProposal();
  const [form, setForm] = useState({
    cover_letter: '',
    proposed_rate: '',
    estimated_hours: '',
    timeline_days: '',
  });

  const handleSubmit = () => {
    if (!form.cover_letter || !form.proposed_rate) {
      toast.error('Cover letter and rate are required');
      return;
    }
    submit.mutate(
      {
        ticket_id: ticketId,
        cover_letter: form.cover_letter,
        proposed_rate: parseFloat(form.proposed_rate),
        estimated_hours: parseFloat(form.estimated_hours) || 0,
        timeline_days: parseInt(form.timeline_days) || 0,
      },
      {
        onSuccess: () => {
          toast.success('Proposal submitted!');
          setOpen(false);
          setForm({ cover_letter: '', proposed_rate: '', estimated_hours: '', timeline_days: '' });
        },
        onError: () => toast.error('Failed to submit proposal'),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gradient-primary border-0 gap-1.5 text-xs">
            <Send className="w-3.5 h-3.5" /> Submit Proposal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit Proposal</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">Bidding on: {ticketTitle}</p>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-xs">Cover Letter</Label>
            <Textarea
              value={form.cover_letter}
              onChange={e => setForm(f => ({ ...f, cover_letter: e.target.value }))}
              placeholder="Explain why you're the best fit for this ticket..."
              className="mt-1 min-h-[100px]"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Hourly Rate ($)</Label>
              <Input type="number" value={form.proposed_rate} onChange={e => setForm(f => ({ ...f, proposed_rate: e.target.value }))} placeholder="150" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Est. Hours</Label>
              <Input type="number" value={form.estimated_hours} onChange={e => setForm(f => ({ ...f, estimated_hours: e.target.value }))} placeholder="20" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Timeline (days)</Label>
              <Input type="number" value={form.timeline_days} onChange={e => setForm(f => ({ ...f, timeline_days: e.target.value }))} placeholder="14" className="mt-1" />
            </div>
          </div>
          {form.proposed_rate && form.estimated_hours && (
            <div className="bg-muted/50 rounded-xl p-3 text-sm">
              <span className="text-muted-foreground">Estimated Total: </span>
              <span className="font-semibold text-foreground">
                ${(parseFloat(form.proposed_rate) * parseFloat(form.estimated_hours)).toLocaleString()}
              </span>
            </div>
          )}
          <Button onClick={handleSubmit} disabled={submit.isPending} className="w-full gradient-primary border-0">
            {submit.isPending ? 'Submitting...' : 'Submit Proposal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

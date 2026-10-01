import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Calculator, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import type { TicketDetail } from '@/hooks/useTicketDetail';

interface Props {
  ticket: TicketDetail;
}

interface Line {
  label: string;
  hours: string;
  cost: string;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'EGP'];

/** The consultant assigned to a ticket proposes the effort and the cost; the client then approves or rejects it. */
export default function TicketPlanSubmitForm({ ticket }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hours, setHours] = useState(ticket.planned_hours ? String(ticket.planned_hours) : '');
  const [cost, setCost] = useState(ticket.planned_cost ? String(ticket.planned_cost) : '');
  const [currency, setCurrency] = useState(ticket.cost_currency || 'USD');
  const [lines, setLines] = useState<Line[]>([]);

  const { data: myConsultantId } = useQuery({
    queryKey: ['my-consultant-id-for-plan'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      return data?.id ?? null;
    },
  });

  // only the consultant assigned to the ticket can submit a plan (the database checks it again)
  if (!ticket.consultant_id || !myConsultantId || myConsultantId !== ticket.consultant_id) return null;

  const hasPlan = !!ticket.plan_submitted_at;

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const handleSubmit = async () => {
    const h = Number(hours);
    const c = Number(cost);
    if (!hours.trim() || !(h > 0)) { toast.error('Enter the planned effort in hours'); return; }
    if (!cost.trim() || !(c >= 0)) { toast.error('Enter the planned cost'); return; }
    const breakdown = lines
      .filter(l => l.label.trim())
      .map(l => ({ label: l.label.trim(), hours: Number(l.hours) || 0, cost: Number(l.cost) || 0 }));
    setSaving(true);
    const { error } = await supabase.rpc('submit_ticket_plan', {
      _ticket_id: ticket.id,
      _planned_hours: h,
      _planned_cost: c,
      _cost_currency: currency,
      _breakdown: breakdown.length > 0 ? breakdown : undefined,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'Could not submit the plan');
      return;
    }
    toast.success('Plan submitted. The client will be asked to approve it.');
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticket.id] });
    queryClient.invalidateQueries({ queryKey: ['case-detail', ticket.id] });
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setOpen(true)}>
        <Calculator className="w-4 h-4" />
        {hasPlan ? 'Revise and resubmit the plan' : 'Submit a cost & effort plan'}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/50 p-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Effort (hours)</Label>
          <Input type="number" min="0" step="0.5" value={hours} onChange={e => setHours(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Total cost</Label>
          <Input type="number" min="0" step="1" value={cost} onChange={e => setCost(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Breakdown (optional)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setLines(prev => [...prev, { label: '', hours: '', cost: '' }])}
            disabled={lines.length >= 10}
          >
            <Plus className="w-3 h-3" /> Add line
          </Button>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_6rem_2rem] gap-2 items-center">
            <Input placeholder="What" value={l.label} maxLength={80} onChange={e => updateLine(i, { label: e.target.value })} />
            <Input placeholder="Hours" type="number" min="0" value={l.hours} onChange={e => updateLine(i, { hours: e.target.value })} />
            <Input placeholder="Cost" type="number" min="0" value={l.cost} onChange={e => updateLine(i, { cost: e.target.value })} />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
              aria-label="Remove line"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={saving} className="flex-1 gap-1.5 gradient-primary border-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Submit plan
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

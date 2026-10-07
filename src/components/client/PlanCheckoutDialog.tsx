import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSubscriptionPlans } from '@/hooks/useSubscriptionPlans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type Quote = { base: number; discount: number; final: number; free_months: number; currency: string; voucher_error: string | null };

export function PlanCheckoutDialog() {
  const qc = useQueryClient();
  const { data: plans = [] } = useSubscriptionPlans();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState('');
  const [tickets, setTickets] = useState('10');
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!planId && plans.length) setPlanId((plans[0] as any).id);
  }, [plans, planId]);

  useEffect(() => {
    const n = parseInt(tickets, 10);
    if (!open || !planId || !(n > 0)) { setQuote(null); return; }
    let cancelled = false;
    (supabase as any).rpc('quote_plan_price', { _plan_id: planId, _tickets: n, _voucher_code: applied || null })
      .then(({ data, error }: any) => {
        if (cancelled) return;
        if (error) { setQuote(null); setQuoteErr(error.message); } else { setQuote(data); setQuoteErr(null); }
      });
    return () => { cancelled = true; };
  }, [open, planId, tickets, applied]);

  const plan: any = plans.find((p: any) => p.id === planId);
  const money = (n: number) => `${quote?.currency ?? 'USD'} ${Number(n).toFixed(2)}`;

  const subscribe = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc('client_subscribe_plan', { _plan_id: planId, _tickets: parseInt(tickets, 10), _voucher_code: applied || null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(quote && (quote.free_months > 0 || quote.final === 0) ? 'Plan activated' : 'Plan requested — your first invoice is now in Payments');
    qc.invalidateQueries();
    setOpen(false); setCode(''); setApplied('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Sparkles className="w-4 h-4" /> Choose a plan</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Choose a plan</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
              <SelectContent>{plans.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            {plan && (plan.ticket_tiers ?? []).length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {plan.ticket_tiers.map((t: any, i: number) => (
                  <li key={i}>{t.max == null ? `${t.min}+` : `${t.min}–${t.max}`} tickets: {t.price}/month</li>
                ))}
              </ul>
            )}
            {plan && !plan.tickets_roll_over && <p className="mt-1 text-xs text-muted-foreground">Unused tickets are not carried over to the next month.</p>}
          </div>
          <div><Label>Tickets per month</Label><Input type="number" min={1} value={tickets} onChange={(e) => setTickets(e.target.value)} /></div>
          <div><Label>Voucher code</Label>
            <div className="flex gap-2">
              <Input value={code} placeholder="Optional" onChange={(e) => setCode(e.target.value)} />
              <Button variant="outline" onClick={() => setApplied(code.trim())}>Apply</Button>
            </div>
            {applied && quote?.voucher_error && <p className="text-xs text-destructive mt-1">{quote.voucher_error}</p>}
            {applied && quote && !quote.voucher_error && <p className="text-xs text-primary mt-1">Voucher applied</p>}
          </div>

          <div className="rounded-xl border p-3 text-sm space-y-1">
            {quoteErr ? <p className="text-destructive">{quoteErr}</p> : quote ? (
              <>
                <div className="flex justify-between"><span>Monthly price</span><span>{money(quote.base)}</span></div>
                {quote.discount > 0 && <div className="flex justify-between text-primary"><span>Voucher discount</span><span>−{money(quote.discount)}</span></div>}
                {quote.free_months > 0 && <div className="flex justify-between text-primary"><span>Voucher</span><span>{quote.free_months} free month{quote.free_months === 1 ? '' : 's'}</span></div>}
                <div className="flex justify-between font-semibold border-t pt-1"><span>Due now</span><span>{money(quote.free_months > 0 ? 0 : quote.final)}</span></div>
              </>
            ) : <p className="text-muted-foreground">Enter a ticket count to see the price.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={subscribe} disabled={busy || !quote || !!quoteErr || (!!applied && !!quote?.voucher_error)}>
            {busy ? 'Submitting…' : 'Subscribe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

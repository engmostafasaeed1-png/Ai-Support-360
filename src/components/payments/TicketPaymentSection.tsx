import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, Loader2, Plus, Receipt, Trash2, Wallet, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Role = 'consultant' | 'client' | 'viewer';
interface Milestone { title: string; percent: number }
interface Line { description: string; quantity: number; unit_price: number }
interface Terms { term_type: string; net_days: number; deposit_percent: number; milestones: Milestone[]; status: string; decision_note: string | null }
interface Invoice {
  id: string; invoice_number: string; lines: Line[]; subtotal: number; vat_percent: number; vat_amount: number; total: number;
  currency: string; note: string | null; status: string; rejection_reason: string | null; created_at: string; payment_id: string | null;
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? 'Something went wrong';
const money = (n: number, c: string) => `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export function termsLabel(t: Pick<Terms, 'term_type' | 'net_days' | 'deposit_percent' | 'milestones'>): string {
  switch (t.term_type) {
    case 'net': return `Net ${t.net_days} days`;
    case 'deposit': return `${t.deposit_percent}% deposit upfront, rest on completion`;
    case 'milestones': return `${t.milestones.length} milestones: ` + t.milestones.map(m => `${m.title} (${m.percent}%)`).join(', ');
    default: return 'Due on receipt';
  }
}

const statusBadge = (s: string) => {
  const map: Record<string, string> = { proposed: 'Awaiting client', sent: 'Awaiting approval', accepted: 'Accepted', approved: 'Approved — awaiting payment', declined: 'Declined', rejected: 'Rejected' };
  const variant = s === 'accepted' || s === 'approved' ? 'default' : s === 'declined' || s === 'rejected' ? 'destructive' : 'secondary';
  return <Badge variant={variant as 'default'}>{map[s] ?? s}</Badge>;
};

interface Props { ticketId: string; role: Role; currency?: string }

/** Payment terms + invoices for a ticket. The consultant sets them; the client approves in-app. */
export default function TicketPaymentSection({ ticketId, role, currency = 'USD' }: Props) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [termsOpen, setTermsOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [reject, setReject] = useState<{ kind: 'terms' | 'invoice'; id?: string } | null>(null);

  const load = useCallback(async () => {
    const [t, i] = await Promise.all([
      supabase.from('ticket_payment_terms').select('*').eq('ticket_id', ticketId).maybeSingle(),
      supabase.from('ticket_invoices').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: false }),
    ]);
    setTerms((t.data as unknown as Terms) ?? null);
    setInvoices((i.data as unknown as Invoice[]) ?? []);
    setLoading(false);
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);

  const acceptTerms = async () => {
    const { error } = await supabase.rpc('respond_ticket_payment_terms', { _ticket_id: ticketId, _accept: true, _note: '' });
    if (error) return toast.error(errText(error));
    toast.success('Payment terms accepted'); load();
  };
  const approveInvoice = async (id: string) => {
    const { error } = await supabase.rpc('respond_ticket_invoice', { _invoice_id: id, _approve: true, _reason: '' });
    if (error) return toast.error(errText(error));
    toast.success('Invoice approved — it now appears in Payments & Invoices for payment'); load();
  };

  return (
    <Card className="rounded-2xl border-border/50 shadow-sm" data-testid="ticket-payment-section">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Payment</CardTitle>
        <p className="text-xs text-muted-foreground">The hourly rate is agreed in the Timesheet section. Payment terms and invoices are handled here.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
          <>
            <section className="space-y-2 rounded-xl border border-border/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Payment terms</h4>
                {terms && statusBadge(terms.status)}
              </div>
              {terms ? <p className="text-sm">{termsLabel(terms)}</p> : <p className="text-sm text-muted-foreground">No payment terms set yet.</p>}
              {terms?.status === 'declined' && terms.decision_note && <p className="text-xs text-destructive">Client's reason: {terms.decision_note}</p>}
              <div className="flex flex-wrap gap-2">
                {role === 'consultant' && <Button size="sm" variant="outline" onClick={() => setTermsOpen(true)}>{terms ? 'Change terms' : 'Set payment terms'}</Button>}
                {role === 'client' && terms?.status === 'proposed' && <>
                  <Button size="sm" onClick={acceptTerms}><CheckCircle2 className="mr-1 h-4 w-4" />Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => setReject({ kind: 'terms' })}><XCircle className="mr-1 h-4 w-4" />Decline</Button>
                </>}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Invoices</h4>
                {role === 'consultant' && <Button size="sm" onClick={() => setInvoiceOpen(true)}><Plus className="mr-1 h-4 w-4" />New invoice</Button>}
              </div>
              {invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
              {invoices.map(inv => (
                <div key={inv.id} className="space-y-2 rounded-xl border border-border/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium"><Receipt className="h-4 w-4 text-primary" />{inv.invoice_number}</span>
                    {statusBadge(inv.status)}
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {inv.lines.map((l, i) => <li key={i}>{l.description} — {l.quantity} × {money(l.unit_price, inv.currency)}</li>)}
                  </ul>
                  <div className="text-sm">
                    Subtotal {money(inv.subtotal, inv.currency)} · VAT {inv.vat_percent}% {money(inv.vat_amount, inv.currency)} · <strong>Total {money(inv.total, inv.currency)}</strong>
                  </div>
                  {inv.note && <p className="text-xs">{inv.note}</p>}
                  {inv.status === 'rejected' && <p className="text-xs text-destructive">Rejected: {inv.rejection_reason}</p>}
                  <p className="text-[11px] text-muted-foreground">Sent {format(new Date(inv.created_at), 'PP')}</p>
                  {role === 'client' && inv.status === 'sent' && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approveInvoice(inv.id)}><CheckCircle2 className="mr-1 h-4 w-4" />Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => setReject({ kind: 'invoice', id: inv.id })}><XCircle className="mr-1 h-4 w-4" />Reject</Button>
                    </div>
                  )}
                  {role === 'client' && inv.status === 'approved' && (
                    <Button size="sm" variant="link" className="h-auto p-0" asChild><a href="/client/payments">Pay in Payments & Invoices</a></Button>
                  )}
                </div>
              ))}
            </section>
          </>
        )}
      </CardContent>

      {role === 'consultant' && <TermsDialog open={termsOpen} onOpenChange={setTermsOpen} ticketId={ticketId} initial={terms} onDone={load} />}
      {role === 'consultant' && <InvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} ticketId={ticketId} currency={currency} onDone={load} />}
      <RejectDialog target={reject} ticketId={ticketId} onClose={() => setReject(null)} onDone={load} />
    </Card>
  );
}

function TermsDialog({ open, onOpenChange, ticketId, initial, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ticketId: string; initial: Terms | null; onDone: () => void }) {
  const [type, setType] = useState('due_on_receipt');
  const [netDays, setNetDays] = useState('30');
  const [deposit, setDeposit] = useState('30');
  const [milestones, setMilestones] = useState<Milestone[]>([{ title: 'Kick-off', percent: 50 }, { title: 'Completion', percent: 50 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !initial) return;
    setType(initial.term_type);
    if (initial.net_days) setNetDays(String(initial.net_days));
    if (initial.deposit_percent) setDeposit(String(initial.deposit_percent));
    if (initial.milestones?.length) setMilestones(initial.milestones);
  }, [open, initial]);

  const sum = milestones.reduce((s, m) => s + (Number(m.percent) || 0), 0);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('set_ticket_payment_terms', {
      _ticket_id: ticketId, _term_type: type, _net_days: Number(netDays), _deposit_percent: Number(deposit),
      _milestones: milestones.map(m => ({ title: m.title.trim(), percent: Number(m.percent) })) as never,
    });
    setSaving(false);
    if (error) return toast.error(errText(error));
    toast.success('Payment terms sent to the client'); onOpenChange(false); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Payment terms</DialogTitle><DialogDescription>The client must accept these before they apply.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="due_on_receipt">Due on receipt</SelectItem>
              <SelectItem value="net">Net 7 / 15 / 30 days</SelectItem>
              <SelectItem value="deposit">Upfront deposit %</SelectItem>
              <SelectItem value="milestones">Milestones</SelectItem>
            </SelectContent>
          </Select>
          {type === 'net' && (
            <Select value={netDays} onValueChange={setNetDays}>
              <SelectTrigger aria-label="Days"><SelectValue /></SelectTrigger>
              <SelectContent>{['7', '15', '30'].map(d => <SelectItem key={d} value={d}>Net {d} days</SelectItem>)}</SelectContent>
            </Select>
          )}
          {type === 'deposit' && (
            <div><Label htmlFor="dep">Deposit percent</Label><Input id="dep" type="number" min={1} max={99} value={deposit} onChange={e => setDeposit(e.target.value)} /></div>
          )}
          {type === 'milestones' && (
            <div className="space-y-2">
              {milestones.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label="Milestone title" value={m.title} onChange={e => setMilestones(ms => ms.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                  <Input aria-label="Percent" type="number" className="w-24" value={m.percent} onChange={e => setMilestones(ms => ms.map((x, j) => j === i ? { ...x, percent: Number(e.target.value) } : x))} />
                  <Button size="icon" variant="ghost" aria-label="Remove milestone" onClick={() => setMilestones(ms => ms.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button size="sm" variant="outline" onClick={() => setMilestones(ms => [...ms, { title: '', percent: 0 }])}><Plus className="mr-1 h-4 w-4" />Add milestone</Button>
                <span className={sum === 100 ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>Total {sum}% (must be 100%)</span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={save} disabled={saving || (type === 'milestones' && sum !== 100)}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Send to client</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Sheet { id: string; billable_hours: number; hourly_rate: number | null; vat_percent: number | null; cost_currency: string; created_at: string }

function InvoiceDialog({ open, onOpenChange, ticketId, currency, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ticketId: string; currency: string; onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unit_price: 0 }]);
  const [vat, setVat] = useState('0');
  const [cur, setCur] = useState(currency);
  const [note, setNote] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from('ticket_timesheet_submissions').select('id,billable_hours,hourly_rate,vat_percent,cost_currency,created_at')
      .eq('ticket_id', ticketId).eq('status', 'signed').order('created_at', { ascending: false })
      .then(({ data }) => setSheets((data as Sheet[]) ?? []));
  }, [open, ticketId]);

  const useSheet = (id: string) => {
    const s = sheets.find(x => x.id === id); if (!s) return;
    setSheetId(id); setCur(s.cost_currency || currency); setVat(String(s.vat_percent ?? 0));
    setLines(ls => [{ description: `Consulting hours (timesheet ${format(new Date(s.created_at), 'PP')})`, quantity: Number(s.billable_hours), unit_price: Number(s.hourly_rate ?? 0) },
      ...ls.filter(l => l.description.trim())]);
  };
  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const vatAmt = subtotal * (Number(vat) || 0) / 100;

  const send = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('send_ticket_invoice', {
      _ticket_id: ticketId, _lines: lines.map(l => ({ description: l.description.trim(), quantity: Number(l.quantity), unit_price: Number(l.unit_price) })) as never,
      _vat_percent: Number(vat), _currency: cur, _timesheet_id: sheetId as string, _note: note,
    });
    setSaving(false);
    if (error) return toast.error(errText(error));
    toast.success('Invoice sent to the client'); onOpenChange(false);
    setLines([{ description: '', quantity: 1, unit_price: 0 }]); setNote(''); setSheetId(null); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New invoice</DialogTitle><DialogDescription>Start from an approved timesheet and add extra lines if needed.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {sheets.length > 0 && (
            <div><Label>From approved timesheet</Label>
              <Select value={sheetId ?? ''} onValueChange={useSheet}>
                <SelectTrigger><SelectValue placeholder="Choose a timesheet" /></SelectTrigger>
                <SelectContent>{sheets.map(s => <SelectItem key={s.id} value={s.id}>{format(new Date(s.created_at), 'PP')} — {s.billable_hours} h × {s.hourly_rate ?? 0} {s.cost_currency}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <Label>Lines</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label="Description" placeholder="Description" value={l.description} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <Input aria-label="Quantity" type="number" className="w-20" value={l.quantity} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} />
              <Input aria-label="Unit price" type="number" className="w-28" value={l.unit_price} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, unit_price: Number(e.target.value) } : x))} />
              <Button size="icon" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setLines(ls => [...ls, { description: '', quantity: 1, unit_price: 0 }])}><Plus className="mr-1 h-4 w-4" />Add line</Button>
          <div className="flex gap-3">
            <div><Label htmlFor="vat">VAT %</Label><Input id="vat" type="number" className="w-24" value={vat} onChange={e => setVat(e.target.value)} /></div>
            <div><Label htmlFor="cur">Currency</Label><Input id="cur" className="w-24 uppercase" maxLength={3} value={cur} onChange={e => setCur(e.target.value.toUpperCase())} /></div>
          </div>
          <div><Label htmlFor="inote">Note (optional)</Label><Textarea id="inote" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></div>
          <p className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-primary" />Subtotal {money(subtotal, cur)} · VAT {money(vatAmt, cur)} · <strong>Total {money(subtotal + vatAmt, cur)}</strong></p>
        </div>
        <DialogFooter><Button onClick={send} disabled={saving || subtotal <= 0}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Send invoice</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ target, ticketId, onClose, onDone }: { target: { kind: 'terms' | 'invoice'; id?: string } | null; ticketId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!target) return;
    setSaving(true);
    const { error } = target.kind === 'terms'
      ? await supabase.rpc('respond_ticket_payment_terms', { _ticket_id: ticketId, _accept: false, _note: reason })
      : await supabase.rpc('respond_ticket_invoice', { _invoice_id: target.id!, _approve: false, _reason: reason });
    setSaving(false);
    if (error) return toast.error(errText(error));
    toast.success('Sent back to the consultant'); setReason(''); onClose(); onDone();
  };
  return (
    <Dialog open={!!target} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{target?.kind === 'terms' ? 'Decline payment terms' : 'Reject invoice'}</DialogTitle><DialogDescription>Tell the consultant what to change.</DialogDescription></DialogHeader>
        <Textarea aria-label="Reason" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="Reason (at least 3 characters)" />
        <DialogFooter><Button onClick={submit} disabled={saving || reason.trim().length < 3}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Send</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

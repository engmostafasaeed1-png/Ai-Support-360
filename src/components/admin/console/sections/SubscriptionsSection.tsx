import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePaymentSettings } from '@/hooks/useBilling';
import { CreditCard, Pencil, Plus, Trash2, Ticket } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Tier = { min: number; max: number | null; price: number };
type Plan = {
  id: string; name: string; description: string | null; price_monthly: number; price_yearly: number | null;
  currency: string | null; is_active: boolean; ticket_tiers: Tier[] | null;
  rate_discount_percent: number; tickets_roll_over: boolean;
};
type Voucher = {
  id: string; code: string; discount_type: 'percent' | 'fixed' | 'free_months'; value: number;
  plan_id: string | null; max_uses: number | null; used_count: number; expires_at: string | null; is_active: boolean;
};

const db = supabase as any;

function usePlans() {
  return useQuery({
    queryKey: ['admin-subscription-plans'],
    queryFn: async () => {
      const { data, error } = await db.from('subscription_plans').select('*').order('price_monthly');
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });
}
function useVouchers() {
  return useQuery({
    queryKey: ['admin-vouchers'],
    queryFn: async () => {
      const { data, error } = await db.from('vouchers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Voucher[];
    },
  });
}

const tierLabel = (t: Tier) => (t.max == null ? `${t.min}+ tickets` : `${t.min}–${t.max} tickets`);
const voucherLabel = (v: Voucher, cur = '$') =>
  v.discount_type === 'percent' ? `${v.value}% off` : v.discount_type === 'fixed' ? `${cur}${v.value} off` : `${v.value} free month${v.value === 1 ? '' : 's'}`;

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    name: plan?.name ?? '', description: plan?.description ?? '',
    price_monthly: String(plan?.price_monthly ?? ''), price_yearly: String(plan?.price_yearly ?? ''),
    is_active: plan?.is_active ?? true,
    rate_discount_percent: String(plan?.rate_discount_percent ?? 0),
    tickets_roll_over: plan?.tickets_roll_over ?? false,
  }));
  const [tiers, setTiers] = useState<Tier[]>(plan?.ticket_tiers ?? []);
  const [saving, setSaving] = useState(false);

  const setTier = (i: number, k: keyof Tier, v: string) =>
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: v === '' && k === 'max' ? null : Number(v) } : t)));

  const save = async () => {
    if (!form.name.trim() || form.price_monthly === '' || Number(form.price_monthly) < 0) return toast.error('Enter a name and a valid monthly price');
    const sorted = [...tiers].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (t.min < 0 || t.price < 0 || (t.max != null && t.max < t.min)) return toast.error(`Range ${i + 1} is invalid`);
      const next = sorted[i + 1];
      if (next && (t.max == null || next.min <= t.max)) return toast.error('Ticket ranges overlap');
    }
    const disc = Number(form.rate_discount_percent || 0);
    if (disc < 0 || disc > 100) return toast.error('Rate discount must be 0–100%');
    setSaving(true);
    const { error } = await db.from('subscription_plans').update({
      name: form.name.trim(), description: form.description.trim() || null,
      price_monthly: Number(form.price_monthly),
      price_yearly: form.price_yearly === '' ? null : Number(form.price_yearly),
      is_active: form.is_active, ticket_tiers: sorted,
      rate_discount_percent: disc, tickets_roll_over: form.tickets_roll_over, updated_at: new Date().toISOString(),
    }).eq('id', plan!.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Plan saved');
    qc.invalidateQueries({ queryKey: ['admin-subscription-plans'] });
    qc.invalidateQueries({ queryKey: ['subscription-plans'] });
    onClose();
  };

  return (
    <Dialog open={!!plan} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit plan</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Monthly price</Label><Input type="number" min={0} value={form.price_monthly} onChange={(e) => setForm({ ...form, price_monthly: e.target.value })} /></div>
            <div><Label>Yearly price</Label><Input type="number" min={0} value={form.price_yearly} onChange={(e) => setForm({ ...form, price_yearly: e.target.value })} /></div>
          </div>
          <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /></div>
          <div><Label>Discount on consultant hourly rates (%)</Label><Input type="number" min={0} max={100} value={form.rate_discount_percent} onChange={(e) => setForm({ ...form, rate_discount_percent: e.target.value })} /></div>
          <div className="flex items-center justify-between gap-3">
            <div><Label>Unused tickets carry over</Label><p className="text-xs text-muted-foreground">When off, the pricing pages say unused tickets are not carried to the next month.</p></div>
            <Switch checked={form.tickets_roll_over} onCheckedChange={(v) => setForm({ ...form, tickets_roll_over: v })} />
          </div>

          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label>Ticket count ranges (monthly price)</Label>
              <Button size="sm" variant="outline" onClick={() => {
                const last = tiers[tiers.length - 1];
                setTiers([...tiers, { min: last ? (last.max ?? last.min) + 1 : 1, max: null, price: 0 }]);
              }}><Plus className="w-4 h-4" /> Add range</Button>
            </div>
            {tiers.length === 0 && <p className="text-xs text-muted-foreground">No ranges — the monthly price applies to any ticket count.</p>}
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs">From</Label><Input type="number" min={0} value={t.min} onChange={(e) => setTier(i, 'min', e.target.value)} /></div>
                <div><Label className="text-xs">To (empty = no limit)</Label><Input type="number" min={0} value={t.max ?? ''} onChange={(e) => setTier(i, 'max', e.target.value)} /></div>
                <div><Label className="text-xs">Price</Label><Input type="number" min={0} value={t.price} onChange={(e) => setTier(i, 'price', e.target.value)} /></div>
                <Button size="icon" variant="ghost" aria-label="Remove range" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const emptyVoucher = { code: '', discount_type: 'percent' as Voucher['discount_type'], value: '', plan_id: 'all', max_uses: '', expires_at: '', is_active: true };

function VoucherDialog({ voucher, open, plans, onClose }: { voucher: Voucher | null; open: boolean; plans: Plan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => voucher ? {
    code: voucher.code, discount_type: voucher.discount_type, value: String(voucher.value),
    plan_id: voucher.plan_id ?? 'all', max_uses: voucher.max_uses ? String(voucher.max_uses) : '',
    expires_at: voucher.expires_at ? voucher.expires_at.slice(0, 10) : '', is_active: voucher.is_active,
  } : emptyVoucher);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = Number(form.value);
    if (!form.code.trim()) return toast.error('Enter a code');
    if (!(value > 0)) return toast.error('Value must be above 0');
    if (form.discount_type === 'percent' && value > 100) return toast.error('Percent cannot exceed 100');
    const row = {
      code: form.code.trim().toUpperCase(), discount_type: form.discount_type, value,
      plan_id: form.plan_id === 'all' ? null : form.plan_id,
      max_uses: form.max_uses === '' ? null : Number(form.max_uses),
      expires_at: form.expires_at ? new Date(form.expires_at + 'T23:59:59').toISOString() : null,
      is_active: form.is_active, updated_at: new Date().toISOString(),
    };
    setSaving(true);
    const { error } = voucher ? await db.from('vouchers').update(row).eq('id', voucher.id) : await db.from('vouchers').insert(row);
    setSaving(false);
    if (error) return toast.error(error.code === '23505' ? 'This code already exists' : error.message);
    toast.success('Voucher saved');
    qc.invalidateQueries({ queryKey: ['admin-vouchers'] });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{voucher ? 'Edit voucher' : 'New voucher'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Code</Label><Input value={form.code} placeholder="SAVE20" onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label>
              <Select value={form.discount_type} onValueChange={(v) => setForm({ ...form, discount_type: v as Voucher['discount_type'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent off</SelectItem>
                  <SelectItem value="fixed">Fixed amount off</SelectItem>
                  <SelectItem value="free_months">Free months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>{form.discount_type === 'percent' ? 'Percent' : form.discount_type === 'fixed' ? 'Amount' : 'Months'}</Label>
              <Input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
          </div>
          <div><Label>Plan</Label>
            <Select value={form.plan_id} onValueChange={(v) => setForm({ ...form, plan_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Max uses (empty = unlimited)</Label><Input type="number" min={1} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} /></div>
            <div><Label>Expires on</Label><Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></div>
          </div>
          <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SubscriptionsSection() {
  const qc = useQueryClient();
  const { data: plans = [], isLoading } = usePlans();
  const { data: vouchers = [], isLoading: vLoading } = useVouchers();
  const { data: pay } = usePaymentSettings();
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [voucherDlg, setVoucherDlg] = useState<{ open: boolean; v: Voucher | null }>({ open: false, v: null });

  const deleteVoucher = async (v: Voucher) => {
    if (!confirm(`Delete voucher ${v.code}?`)) return;
    const { error } = await db.from('vouchers').delete().eq('id', v.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['admin-vouchers'] });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" /> Subscriptions & Plans
        </h2>
        <p className="text-sm text-muted-foreground">Manage plans, ticket ranges and vouchers</p>
        {pay && !pay.plans && (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
            <p className="font-medium">Plans are switched off.</p>
            <p className="mt-0.5 text-xs">
              Clients pay per approved timesheet: the hourly rate plus the platform service fee, the payment processing fee and VAT. The plans below are stored but are not offered to clients, and no company is on a plan. Plans are switched on under Payments & payouts.
            </p>
          </div>
        )}
      </div>



      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}</div>
      ) : plans.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="rounded-2xl">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="text-xs">{plan.name}</Badge>
                  <div className="flex items-center gap-1">
                    {!plan.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                    <Button size="icon" variant="ghost" aria-label={`Edit ${plan.name}`} onClick={() => setEditPlan(plan)}><Pencil className="w-4 h-4" /></Button>
                  </div>
                </div>
                <p className="text-3xl font-bold text-foreground text-center">
                  ${plan.price_monthly}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-xs text-muted-foreground text-center">{plan.description || 'No description'}</p>
                <div className="flex flex-wrap justify-center gap-1">
                  {Number(plan.rate_discount_percent) > 0 && <Badge variant="secondary" className="text-xs">{plan.rate_discount_percent}% off consultant rates</Badge>}
                  <Badge variant="outline" className="text-xs">{plan.tickets_roll_over ? 'Unused tickets carry over' : 'No ticket carry-over'}</Badge>
                </div>
                {(plan.ticket_tiers ?? []).length > 0 && (
                  <ul className="text-xs space-y-1 border-t pt-2">
                    {plan.ticket_tiers!.map((t, i) => (
                      <li key={i} className="flex justify-between"><span className="text-muted-foreground">{tierLabel(t)}</span><span className="font-medium">${t.price}/mo</span></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground">No subscription plans configured yet.</CardContent></Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2"><Ticket className="w-5 h-5 text-primary" /> Vouchers</h3>
          <Button size="sm" onClick={() => setVoucherDlg({ open: true, v: null })}><Plus className="w-4 h-4" /> New voucher</Button>
        </div>
        {vLoading ? <Skeleton className="h-24 w-full rounded-2xl" /> : vouchers.length === 0 ? (
          <Card className="rounded-2xl"><CardContent className="py-8 text-center text-muted-foreground">No vouchers yet.</CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {vouchers.map((v) => {
              const expired = v.expires_at && new Date(v.expires_at) < new Date();
              const usedUp = v.max_uses != null && v.used_count >= v.max_uses;
              return (
                <Card key={v.id} className="rounded-2xl">
                  <CardContent className="pt-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold">{v.code}</span>
                        <Badge variant={v.is_active && !expired && !usedUp ? 'default' : 'secondary'} className="text-xs">
                          {!v.is_active ? 'Inactive' : expired ? 'Expired' : usedUp ? 'Used up' : 'Active'}
                        </Badge>
                      </div>
                      <p className="text-sm">{voucherLabel(v)} · {plans.find((p) => p.id === v.plan_id)?.name ?? 'All plans'}</p>
                      <p className="text-xs text-muted-foreground">
                        Used {v.used_count}{v.max_uses ? ` / ${v.max_uses}` : ''} · {v.expires_at ? `Expires ${new Date(v.expires_at).toLocaleDateString()}` : 'No expiry'}
                      </p>
                    </div>
                    <div className="flex shrink-0">
                      <Button size="icon" variant="ghost" aria-label={`Edit ${v.code}`} onClick={() => setVoucherDlg({ open: true, v })}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${v.code}`} onClick={() => deleteVoucher(v)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {editPlan && <PlanDialog key={editPlan.id} plan={editPlan} onClose={() => setEditPlan(null)} />}
      {voucherDlg.open && <VoucherDialog key={voucherDlg.v?.id ?? 'new'} open voucher={voucherDlg.v} plans={plans} onClose={() => setVoucherDlg({ open: false, v: null })} />}
    </div>
  );
}

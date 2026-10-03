import { useEffect, useState, type ChangeEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Landmark, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useMyPayoutDetails, useSavePayoutDetails } from '@/hooks/useBilling';

/** The consultant's own bank details: where the platform transfers the payouts. */
export default function PayoutDetailsCard() {
  const { data, isLoading } = useMyPayoutDetails();
  const save = useSavePayoutDetails();
  const [form, setForm] = useState({
    account_holder: '', bank_name: '', iban: '', account_number: '', swift_bic: '', country: '', currency: 'USD', notes: '',
  });

  useEffect(() => {
    const d = data?.details;
    if (d) {
      setForm({
        account_holder: d.account_holder ?? '', bank_name: d.bank_name ?? '', iban: d.iban ?? '', account_number: d.account_number ?? '',
        swift_bic: d.swift_bic ?? '', country: d.country ?? '', currency: d.currency ?? 'USD', notes: d.notes ?? '',
      });
    }
  }, [data?.details]);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return <p className="text-sm text-muted-foreground">Bank details are for consultant accounts.</p>;

  const valid = form.account_holder.trim().length >= 2 && form.bank_name.trim().length >= 2 && (form.iban.trim() || form.account_number.trim());
  const d = data.details;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center gap-2">
        <Landmark className="w-5 h-5 text-primary" />
        <CardTitle className="text-base">Bank details for your payouts</CardTitle>
        <div className="ms-auto">
          {!d ? <Badge variant="destructive" className="text-[10px]">Missing</Badge>
            : d.verified_at ? <Badge className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Verified</Badge>
            : <Badge variant="secondary" className="text-[10px]">Waiting for verification</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!d && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Add your bank details so that the platform can transfer your payouts. Without them a payout can not be started.</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Only you and the platform administrators can see these details. If you change any of them, the platform checks them again before the next payout.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Account holder *</Label>
            <Input value={form.account_holder} onChange={set('account_holder')} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bank *</Label>
            <Input value={form.bank_name} onChange={set('bank_name')} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">IBAN</Label>
            <Input value={form.iban} onChange={set('iban')} maxLength={42} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account number (if you have no IBAN)</Label>
            <Input value={form.account_number} onChange={set('account_number')} maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">SWIFT / BIC</Label>
            <Input value={form.swift_bic} onChange={set('swift_bic')} maxLength={11} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Country</Label>
            <Input value={form.country} onChange={set('country')} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Currency of the account</Label>
            <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} className="w-28" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Notes for the administrator (optional)</Label>
          <Textarea value={form.notes} onChange={set('notes')} rows={2} maxLength={500} />
        </div>
        <div className="flex justify-end">
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate({ consultantId: data.consultantId, ...form })}
          >
            Save bank details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

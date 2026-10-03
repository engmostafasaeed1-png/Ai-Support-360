import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { usePaymentInstructions, useReportPayment } from '@/hooks/useBilling';

// today in the client's own time zone, as YYYY-MM-DD
const today = () => new Date().toLocaleDateString('en-CA');

const money = (n: number | string, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(n));
  } catch {
    return `${Number(n).toFixed(2)} ${currency}`;
  }
};

function CopyRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-1 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-end break-all">{value}</span>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => { navigator.clipboard?.writeText(value); toast.success(`${label} copied`); }}
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** "How to pay" for an open invoice: the platform bank details, the payment reference and the "I have paid" report. */
export function PayInvoiceCard({ payment }: { payment: any }) {
  const { isGuest } = useGuestMode();
  const open = payment?.status === 'pending' && !isGuest;
  const { data: bank, isLoading } = usePaymentInstructions(open);
  const report = useReportPayment();
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');

  if (!open) return null;

  const hasBank = !!bank && (bank.iban || bank.account_number);

  return (
    <Card className="rounded-xl border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-semibold text-primary uppercase flex items-center gap-1.5">
          <Banknote className="w-3.5 h-3.5" /> How to pay
        </p>

        {payment.rejection_note && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>We could not find your transfer: {payment.rejection_note}</span>
          </div>
        )}

        <p className="text-sm text-foreground">
          Transfer <strong>{money(payment.amount, payment.currency)}</strong> by bank transfer to the account below and write this reference in the transfer:
        </p>
        <div className="rounded-lg bg-background border px-3 py-2 flex items-center justify-between">
          <span className="font-mono font-semibold tracking-wide">{payment.reference || '-'}</span>
          {payment.reference && (
            <button
              type="button"
              aria-label="Copy the payment reference"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => { navigator.clipboard?.writeText(payment.reference); toast.success('Reference copied'); }}
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : hasBank ? (
          <div className="rounded-lg bg-background border px-3 py-1">
            <CopyRow label="Account holder" value={bank?.beneficiary} />
            <CopyRow label="Bank" value={bank?.bank_name} />
            <CopyRow label="IBAN" value={bank?.iban} />
            <CopyRow label="Account number" value={bank?.account_number} />
            <CopyRow label="SWIFT / BIC" value={bank?.swift} />
            <CopyRow label="Country" value={bank?.country} />
            <CopyRow label="Currency" value={bank?.currency} />
            {bank?.instructions && <p className="text-xs text-muted-foreground py-2">{bank.instructions}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">The bank details are not available yet. Please contact support.</p>
        )}

        {payment.client_reported_at ? (
          <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 p-2 text-xs text-green-900">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              You reported this payment on {format(new Date(payment.client_reported_at), 'MMM d, yyyy')}
              {payment.client_transfer_reference ? ` (transfer reference ${payment.client_transfer_reference})` : ''}.
              We confirm it when the money arrives.
            </span>
          </div>
        ) : (
          <div className="space-y-2 pt-1 border-t border-border/40">
            <p className="text-xs text-muted-foreground">After you made the transfer, tell us, so that we find it faster.</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Reference of your transfer *</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Number from your bank receipt" maxLength={120} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date of the transfer *</Label>
                <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!reference.trim() || !date || report.isPending}
              onClick={() => report.mutate({ paymentId: payment.id, reference: reference.trim(), date, note })}
            >
              I have paid
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

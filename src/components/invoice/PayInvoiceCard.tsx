import { createPortal } from 'react-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, Copy, CheckCircle2, AlertTriangle, CreditCard, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useInvoiceBankDetails, usePaymentMethods, useReportPayment, useStartCardPayment } from '@/hooks/useBilling';

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
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-xs py-1.5 border-b border-border/30 last:border-0">
      <span className="col-start-1 text-muted-foreground">{label}</span>
      <span dir="auto" className="col-start-1 min-w-0 font-mono break-words [overflow-wrap:anywhere]">{value}</span>
      <Button variant="ghost" size="icon"
        type="button"
        aria-label={`Copy ${label}`}
        className="col-start-2 row-start-1 row-span-2 h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => { navigator.clipboard?.writeText(value); toast.success(`${label} copied`); }}
      >
        <Copy className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

/** Why bank transfer is open for this invoice (the server tells the reason). */
const BANK_REASON: Record<string, string> = {
  cards_off: 'Card payment (Visa, Mastercard) is not available yet. Until it is, you can pay by bank transfer.',
  company: 'The platform administrator allowed bank transfer for your company.',
  invoice: 'The platform administrator allowed bank transfer for this invoice.',
};

/**
 * "How to pay" for an open invoice. Card payment (Visa, Mastercard) is the main way.
 * Bank transfer is shown only when the administrator allowed it for the company or for this invoice, or while card payment is not switched on yet.
 */
export function PayInvoiceCard({ payment, compact = false, actionsContainer, canReport = true }: { payment: any; compact?: boolean; actionsContainer?: HTMLElement | null; canReport?: boolean }) {
  const { isGuest } = useGuestMode();
  const open = payment?.status === 'pending' && !isGuest;
  const methodsQ = usePaymentMethods(payment?.id, open);
  const methods = methodsQ.data;
  const cardOn = !!methods?.card;
  const bankOpen = !!methods?.bank_transfer;
  const bankQ = useInvoiceBankDetails(payment?.id, open && bankOpen);
  const bank = bankQ.data;
  const startCard = useStartCardPayment();
  const report = useReportPayment();
  const [reportOpen, setReportOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [agreed, setAgreed] = useState(false);

  if (!open) return null;

  const hasBank = !!bank && !!(bank.iban || bank.account_number);
  const cardStartedAt = payment.card_started_at ? new Date(payment.card_started_at) : null;
  const cardStartedRecently = payment.provider_status === 'initiated' && !!cardStartedAt && Date.now() - cardStartedAt.getTime() < 60 * 60 * 1000;
  const cardFailed = payment.provider_status === 'failed';
  const hasConsultant = !!payment.consultant && payment.consultant !== 'Unassigned';

  const reportedBox = payment.client_reported_at ? (
    <div className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/30 p-2 text-xs text-success">
      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        You reported this payment on {format(new Date(payment.client_reported_at), 'MMM d, yyyy')}
        {payment.client_transfer_reference ? ` (transfer reference ${payment.client_transfer_reference})` : ''}.
        We confirm it when the money arrives.
      </span>
    </div>
  ) : null;

  return (
    <div className={compact ? "min-w-0" : "rounded-xl border border-primary/30 bg-primary/5"}>
      <div className={compact ? "space-y-2" : "p-4 space-y-3"}>
        <p className="text-xs font-semibold text-primary uppercase flex items-center gap-1.5">
          <Banknote className="w-3.5 h-3.5" /> How to pay
        </p>

        {methodsQ.isLoading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : !methods ? (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>We could not load the ways to pay this invoice. Please reload the page, or contact support.</span>
          </div>
        ) : (
          <>
            {hasConsultant && (
              <p className="text-xs text-muted-foreground">
                You pay the platform, not the consultant. After the platform receives your payment, it pays the consultant within 15 business days.
              </p>
            )}

            {cardOn && (
              <div className="rounded-lg bg-background border p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-primary" /> Pay by card
                </p>
                <p className="text-xs text-muted-foreground">
                  You pay <strong>{money(payment.amount, payment.currency)}</strong> on the secure page of our payment provider. Your invoice is marked as paid
                  automatically, and we never see your card number.
                </p>
                {cardFailed && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      {bankOpen
                        ? 'Your last card payment was not completed. You can try again, or pay by bank transfer below.'
                        : 'Your last card payment was not completed. You can try again.'}
                    </span>
                  </div>
                )}
                {cardStartedRecently && cardStartedAt && (
                  <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 p-2 text-xs text-blue-900">
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      A card payment was started on {format(cardStartedAt, 'MMM d, HH:mm')}. If you completed it, this invoice is updated in a moment.
                      Otherwise you can start again.
                    </span>
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs rounded-md bg-muted/40 p-2">
                  <dt className="text-muted-foreground">Total</dt><dd className="font-semibold text-end">{money(payment.amount, payment.currency)}</dd>
                  <dt className="text-muted-foreground">Currency</dt><dd className="text-end">{payment.currency}</dd>
                  <dt className="text-muted-foreground">Taxes</dt><dd className="text-end">{payment.vat_amount != null ? `${money(payment.vat_amount, payment.currency)} VAT included` : 'Included as shown on invoice'}</dd>
                  <dt className="text-muted-foreground">Billing</dt><dd className="text-end">One-time payment</dd>
                  <dt className="text-muted-foreground">Renews automatically</dt><dd className="text-end">No</dd>
                </dl>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                  <span>
                    I agree to the <a href="/terms-and-conditions" target="_blank" rel="noopener" className="text-primary underline">Terms &amp; Conditions</a>,{' '}
                    <a href="/refund-policy" target="_blank" rel="noopener" className="text-primary underline">Refund Policy</a> and{' '}
                    <a href="/privacy-policy" target="_blank" rel="noopener" className="text-primary underline">Privacy Policy</a>.
                  </span>
                </label>
                <Button className="w-full gap-1.5" disabled={startCard.isPending || !agreed} onClick={() => startCard.mutate(payment.id)}>
                  {startCard.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  Pay {money(payment.amount, payment.currency)} by card
                </Button>
              </div>
            )}

            {bankOpen ? (
              <div className="space-y-3">
                {cardOn ? (
                  <p className="text-xs font-semibold text-muted-foreground uppercase pt-1">Or pay by bank transfer</p>
                ) : (
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-primary" /> Pay by bank transfer
                  </p>
                )}
                {methods.bank_transfer_reason && <p className="text-xs text-muted-foreground">{BANK_REASON[methods.bank_transfer_reason]}</p>}

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
                    <Button variant="ghost" size="icon"
                      type="button"
                      aria-label="Copy the payment reference"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { navigator.clipboard?.writeText(payment.reference); toast.success('Reference copied'); }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                {bankQ.isLoading ? (
                  <Skeleton className="h-24 rounded-lg" />
                ) : bankQ.isError ? (
                  <p className="text-xs text-muted-foreground">The bank details could not be loaded. Please reload the page, or contact support.</p>
                ) : hasBank ? (
                  <div className={compact ? "grid grid-cols-1 md:grid-cols-2 gap-x-3 rounded-lg bg-background border px-2 py-1" : "rounded-lg bg-background border px-3 py-1"}>
                    <CopyRow label="Account holder" value={bank?.beneficiary} />
                    <CopyRow label="Bank" value={bank?.bank_name} />
                    <CopyRow label="IBAN" value={bank?.iban} />
                    <CopyRow label="Account number" value={bank?.account_number} />
                    <CopyRow label="SWIFT / BIC" value={bank?.swift} />
                    <CopyRow label="Country" value={bank?.country} />
                    <CopyRow label="Currency" value={bank?.currency} />
                    {bank?.instructions && <p className="text-xs text-muted-foreground py-1.5 md:col-span-2">{bank.instructions}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">The bank details are not available yet. Please contact support.</p>
                )}

                {reportedBox ?? (
                  canReport ? (compact ? (
                    <Dialog open={reportOpen} onOpenChange={setReportOpen}>
                      <DialogContent aria-describedby={undefined} className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
                        <DialogHeader><DialogTitle>I have paid</DialogTitle></DialogHeader>
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
                      onClick={() => report.mutate({ paymentId: payment.id, reference: reference.trim(), date, note }, { onSuccess: () => setReportOpen(false) })}
                    >
                      I have paid
                    </Button>
                  </div>
                      </DialogContent>
                    </Dialog>
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
                  )) : null
                )}
              </div>
            ) : (
              <>
                {reportedBox}
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Bank transfer is not available for this invoice. If you need it, ask the platform administrator through Support to allow it.</span>
                </p>
              </>
            )}
          </>
        )}
      </div>
      {compact && actionsContainer && bankOpen && canReport && createPortal(
        payment.client_reported_at ? (
          <Button disabled className="h-auto min-h-10 whitespace-normal py-2 text-xs">
            Payment reported on {format(new Date(payment.client_reported_at), 'MMM d, yyyy')} - waiting for confirmation
          </Button>
        ) : (
          <Button className="h-auto min-h-10 whitespace-normal py-2 text-xs" onClick={() => setReportOpen(true)}>
            <CheckCircle2 className="h-4 w-4" /> I have paid - confirm payment
          </Button>
        ), actionsContainer)}
    </div>
  );
}

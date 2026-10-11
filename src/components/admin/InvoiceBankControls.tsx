import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useInvoiceBankAccounts, useInvoiceBankGrants, usePaymentMethods, usePaymentSettings,
  useSetInvoiceBankAccount, useSetInvoiceBankTransfer, type BankDetails,
} from '@/hooks/useBilling';

export interface InvoiceBankControlsInvoice {
  id: string;
  status: string;
  invoice_number?: string | null;
  amount: number | string;
  currency?: string | null;
  client_name?: string | null;
}

const money = (n: number | string | null | undefined, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(n ?? 0));
  } catch {
    return `${Number(n ?? 0).toFixed(2)} ${currency}`;
  }
};

const REASON: Record<string, string> = {
  cards_off: 'Card payments are off, so bank transfer is open for everybody. A permission that you give counts when card payments are switched on.',
  company: 'The company of this invoice is allowed to pay by bank transfer.',
  invoice: 'You allowed bank transfer for this invoice.',
};

const FIELDS: [keyof BankDetails, string][] = [
  ['beneficiary', 'Account holder'],
  ['bank_name', 'Bank'],
  ['iban', 'IBAN'],
  ['account_number', 'Account number'],
  ['swift', 'SWIFT / BIC'],
  ['currency', 'Currency'],
  ['country', 'Country'],
];

/** Admin: the payment options of ONE open invoice: may the client pay it by bank transfer, and into which bank account. */
export default function InvoiceBankControls({ invoice, onClose }: { invoice: InvoiceBankControlsInvoice | null; onClose: () => void }) {
  const invoiceId = invoice?.id;
  const isOpenInvoice = invoice?.status === 'pending';
  const methodsQ = usePaymentMethods(invoiceId, !!invoice);
  const grantsQ = useInvoiceBankGrants();
  const accountsQ = useInvoiceBankAccounts();
  const settingsQ = usePaymentSettings();
  const setTransfer = useSetInvoiceBankTransfer();
  const setAccount = useSetInvoiceBankAccount();
  const grant = invoiceId ? grantsQ.data?.[invoiceId] : undefined;
  const own = invoiceId ? accountsQ.data?.[invoiceId] : undefined;
  const ownSetAt = own?.set_at;
  const ownRef = useRef(own);
  ownRef.current = own;
  const platform: BankDetails = settingsQ.data?.bank ?? {};
  const [note, setNote] = useState('');
  const [accountNote, setAccountNote] = useState('');
  const [form, setForm] = useState<BankDetails>({});

  useEffect(() => {
    if (invoiceId) {
      setNote('');
      setAccountNote('');
      setForm(ownRef.current?.details ?? {});
    }
  }, [invoiceId, ownSetAt]);

  const clean: BankDetails = {};
  (Object.keys(form) as (keyof BankDetails)[]).forEach((k) => {
    const v = String(form[k] ?? '').trim();
    if (v) clean[k] = k === 'currency' ? v.toUpperCase() : v;
  });
  const canSave = !!clean.beneficiary && !!(clean.iban || clean.account_number);

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment options</DialogTitle>
          <DialogDescription>
            {invoice ? `${invoice.invoice_number ?? ''} - ${money(invoice.amount, invoice.currency ?? 'USD')} - ${invoice.client_name ?? ''}` : ''}
          </DialogDescription>
        </DialogHeader>

        {!isOpenInvoice ? (
          <p className="py-2 text-sm text-muted-foreground">This invoice is not open any more, so its payment options can not be changed.</p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-semibold">Bank transfer for this invoice</p>
              {methodsQ.isLoading ? (
                <Skeleton className="h-8 rounded-md" />
              ) : methodsQ.data ? (
                <p className="text-xs text-muted-foreground">
                  {methodsQ.data.bank_transfer_reason
                    ? REASON[methodsQ.data.bank_transfer_reason]
                    : 'Bank transfer is not open for this invoice: the client can pay by card only.'}
                </p>
              ) : (
                <p className="text-xs text-destructive">The payment options could not be loaded.</p>
              )}
              <div className="flex items-center gap-3">
                <Switch
                  checked={!!grant}
                  disabled={setTransfer.isPending}
                  onCheckedChange={(on) => { if (invoiceId) setTransfer.mutate({ paymentId: invoiceId, allowed: on, note }); }}
                  aria-label="Allow bank transfer for this invoice"
                />
                <span className="text-sm">{grant ? 'Allowed for this invoice' : 'Not allowed for this invoice'}</span>
              </div>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional, for your records)" />
              <p className="text-[11px] text-muted-foreground">The client is told when you allow it or stop it. The note is not shown to the client.</p>
            </section>

            <section className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-semibold">Bank account for this invoice</p>
              <p className="text-xs text-muted-foreground">
                {own
                  ? 'This invoice has its own bank account. Clients who may pay it by bank transfer see this account.'
                  : 'This invoice uses the platform bank account, the same as all other invoices (Settings tab).'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {FIELDS.map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input aria-label={label} value={form[key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Instructions for the client (optional)</Label>
                <Textarea
                  value={form.instructions ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                  rows={2}
                  maxLength={1000}
                />
              </div>
              <Input value={accountNote} onChange={(e) => setAccountNote(e.target.value)} maxLength={300} placeholder="Note (optional, for your records)" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setForm({ ...platform })}>
                  Start from the platform account
                </Button>
                <div className="flex flex-wrap gap-2">
                  {own && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setAccount.isPending}
                      onClick={() => { if (invoiceId) setAccount.mutate({ paymentId: invoiceId, details: null, note: accountNote }); }}
                    >
                      Use the platform account again
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!canSave || setAccount.isPending}
                    onClick={() => { if (invoiceId) setAccount.mutate({ paymentId: invoiceId, details: clean, note: accountNote }); }}
                  >
                    Save the account of this invoice
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                The client is told when the account of the invoice changes. To change the account for all invoices, use the Settings tab (Bank details for client payments).
              </p>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTenant } from '@/contexts/TenantContext';
import { useReissueInvoices, useSaveTenantBillingDetails, useTenantBillingDetails } from '@/hooks/useBusinessInvoice';
import {
  BILLING_LIMITS,
  EMPTY_BILLING_FORM,
  billingDetailsComplete,
  hasBillingErrors,
  validateBillingForm,
  type BillingErrors,
  type BillingField,
  type BillingForm,
} from '@/lib/businessInvoice';

type PaymentLike = { id: string; invoice: string; tenant_id: string | null; buyer_details: unknown };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payments: PaymentLike[];
}

const FIELDS: { key: BillingField; label: string; required?: boolean; wide?: boolean; placeholder?: string }[] = [
  { key: 'business_name', label: 'Business name', required: true, wide: true, placeholder: 'The legal name of your company' },
  { key: 'tax_number', label: 'Tax number (VAT or tax registration)' },
  { key: 'commercial_registration', label: 'Commercial registration number' },
  { key: 'address_line', label: 'Address', required: true, wide: true, placeholder: 'Street, building, floor' },
  { key: 'city', label: 'City' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'country', label: 'Country', required: true },
  { key: 'billing_email', label: 'Billing e-mail' },
  { key: 'phone', label: 'Phone' },
  { key: 'reference_note', label: 'Your reference (for example a purchase order number)', wide: true },
];

/** Lets a client choose to be invoiced as a business: the owner or an administrator of the company saves the business details here. */
export default function BusinessInvoiceCard({ open, onOpenChange, payments }: Props) {
  const { tenant, isOwnerOrAdmin } = useTenant();
  const detailsQ = useTenantBillingDetails(tenant?.id);
  const save = useSaveTenantBillingDetails(tenant?.id);
  const reissueMany = useReissueInvoices();
  const [form, setForm] = useState<BillingForm>(EMPTY_BILLING_FORM);
  const [errors, setErrors] = useState<BillingErrors>({});
  const [confirmOlder, setConfirmOlder] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(detailsQ.data?.form ?? EMPTY_BILLING_FORM);
      setErrors({});
    }
  }, [open, detailsQ.data]);

  // the invoices of this company that were issued without business details
  const older = useMemo(
    () => (tenant ? payments.filter((p) => p.tenant_id === tenant.id && !p.buyer_details) : []),
    [payments, tenant],
  );

  if (!tenant) return null;

  const saved = detailsQ.data?.form ?? EMPTY_BILLING_FORM;
  const on = saved.issue_business_invoices;
  const complete = billingDetailsComplete(saved);
  const canUpdateOlder = isOwnerOrAdmin && complete && older.length > 0;
  const addressText = [saved.address_line, [saved.city, saved.postal_code].filter(Boolean).join(' '), saved.country].filter(Boolean).join(', ');

  const setField = (key: BillingField, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = () => {
    const found = validateBillingForm(form);
    setErrors(found);
    if (hasBillingErrors(found)) return;
    save.mutate(form, { onSuccess: () => onOpenChange(false) });
  };

  const updateOlder = () => {
    reissueMany.mutate(
      older.map((p) => ({ id: p.id, invoice: p.invoice })),
      { onSettled: () => setConfirmOlder(false) },
    );
  };

  return (
    <>
      <Card className="rounded-2xl border-border/50">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Building2 aria-hidden="true" className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-foreground">Business invoices</p>
              {detailsQ.isLoading ? (
                <Skeleton className="h-4 w-64" />
              ) : detailsQ.error ? (
                <p className="text-xs text-destructive">The business details could not be loaded.</p>
              ) : on ? (
                <>
                  <p dir="auto" className="text-sm text-foreground">
                    Your invoices are issued to <span className="font-medium">{saved.business_name}</span>
                    {saved.tax_number ? <span className="text-muted-foreground"> (tax number {saved.tax_number})</span> : null}.
                  </p>
                  {addressText ? <p dir="auto" className="text-xs text-muted-foreground">{addressText}</p> : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your invoices are issued to you personally. Turn on business invoices to print the name, the address and the tax number of your company on them.
                  {complete ? ' Your business details are saved, they are not used yet.' : ''}
                </p>
              )}
              {on && complete && older.length > 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {older.length} older invoice{older.length === 1 ? ' was' : 's were'} issued without these details.{' '}
                  {isOwnerOrAdmin ? 'You can add them with the button.' : 'An owner or administrator of your company can add them.'}
                </p>
              ) : null}
              {!isOwnerOrAdmin && !detailsQ.isLoading ? (
                <p className="text-xs text-muted-foreground">Only an owner or an administrator of the company can change the business details.</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {isOwnerOrAdmin && !detailsQ.isLoading ? (
              <Button size="sm" variant={on ? 'outline' : 'default'} onClick={() => onOpenChange(true)}>
                {on || complete ? 'Edit business details' : 'Set up business invoices'}
              </Button>
            ) : null}
            {canUpdateOlder && on ? (
              <Button size="sm" onClick={() => setConfirmOlder(true)} disabled={reissueMany.isPending}>
                Add the details to {older.length} older invoice{older.length === 1 ? '' : 's'}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Business invoice details</DialogTitle>
            <DialogDescription>
              These details are printed on your invoices as the customer. Every invoice keeps a copy of the details it was issued with,
              so changing them later does not change an invoice that already exists.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
              <Switch
                id="bi-on"
                checked={form.issue_business_invoices}
                onCheckedChange={(value) => setForm((f) => ({ ...f, issue_business_invoices: value }))}
                aria-label="Issue my new invoices as business invoices"
              />
              <div className="space-y-0.5">
                <Label htmlFor="bi-on" className="text-sm font-medium">Issue my new invoices as business invoices</Label>
                <p className="text-xs text-muted-foreground">
                  When it is on, every new invoice of {tenant.name} carries these details. Turn it off to be invoiced personally again.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={`space-y-1.5 ${f.wide ? 'sm:col-span-2' : ''}`}>
                  <Label htmlFor={`bi-${f.key}`} className="text-xs">
                    {f.label}{f.required && form.issue_business_invoices ? ' *' : ''}
                  </Label>
                  <Input
                    id={`bi-${f.key}`}
                    dir="auto"
                    autoComplete="off"
                    value={form[f.key]}
                    maxLength={BILLING_LIMITS[f.key]}
                    placeholder={f.placeholder}
                    aria-invalid={!!errors[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                  {errors[f.key] ? <p className="text-xs text-destructive">{errors[f.key]}</p> : null}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Ask your accountant which name and which tax number must be on your invoices.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={submit} className="gap-1.5">
              {save.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOlder} onOpenChange={setConfirmOlder}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add the business details to {older.length} older invoice{older.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              The invoice numbers and the amounts do not change. Each invoice is re-issued as a new revision with {saved.business_name || 'your business'} as
              the customer. This includes invoices that are already paid. Nobody is notified.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 list-inside list-disc overflow-y-auto text-sm text-foreground">
            {older.slice(0, 10).map((p) => <li key={p.id}>{p.invoice}</li>)}
            {older.length > 10 ? <li className="list-none text-muted-foreground">and {older.length - 10} more</li> : null}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOlder(false)}>Cancel</Button>
            <Button disabled={reissueMany.isPending} onClick={updateOlder} className="gap-1.5">
              {reissueMany.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null} Add the details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

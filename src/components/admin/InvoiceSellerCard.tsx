import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useInvoiceSellerDetails, useSaveInvoiceSellerDetails } from '@/hooks/useBusinessInvoice';
import {
  EMPTY_SELLER,
  SELLER_FIELDS,
  SELLER_LIMITS,
  cleanBillingText,
  validateSellerDetails,
  type SellerDetails,
  type SellerErrors,
  type SellerField,
} from '@/lib/businessInvoice';

const FIELDS: { key: SellerField; label: string; wide?: boolean; placeholder?: string }[] = [
  { key: 'legal_name', label: 'Legal name *', wide: true },
  { key: 'legal_name_ar', label: 'Legal name in Arabic (optional)', wide: true },
  { key: 'address_line', label: 'Address', wide: true },
  { key: 'city', label: 'City' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'commercial_registration', label: 'Commercial registration number' },
  { key: 'tax_number', label: 'Tax registration number' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website', wide: true, placeholder: 'https://' },
];

/** The company that issues the invoices: these details are printed at the top of every invoice. */
export default function InvoiceSellerCard() {
  const sellerQ = useInvoiceSellerDetails();
  const save = useSaveInvoiceSellerDetails();
  const [form, setForm] = useState<SellerDetails>(EMPTY_SELLER);
  const [errors, setErrors] = useState<SellerErrors>({});

  useEffect(() => {
    if (sellerQ.data) setForm(sellerQ.data);
  }, [sellerQ.data]);

  if (sellerQ.isLoading) return <Skeleton className="h-64 rounded-2xl" />;

  const stored = sellerQ.data ?? EMPTY_SELLER;
  const dirty = SELLER_FIELDS.some((k) => cleanBillingText(form[k]) !== cleanBillingText(stored[k]));

  const setField = (key: SellerField, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = () => {
    const found = validateSellerDetails(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(form);
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText aria-hidden="true" className="h-4 w-4" /> Invoice seller details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          The company that issues the invoices. These details are printed at the top of every invoice (the printable page of an invoice reads them when it opens,
          so a change shows on old invoices too). Ask your accountant which details must be on an invoice, for example the tax registration number.
        </p>
        {sellerQ.error ? <p className="text-xs text-destructive">The seller details could not be loaded.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={`space-y-1.5 ${f.wide ? 'sm:col-span-2' : ''}`}>
              <Label htmlFor={`seller-${f.key}`} className="text-xs">{f.label}</Label>
              <Input
                id={`seller-${f.key}`}
                dir="auto"
                autoComplete="off"
                value={form[f.key]}
                maxLength={SELLER_LIMITS[f.key]}
                placeholder={f.placeholder}
                aria-invalid={!!errors[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
              />
              {errors[f.key] ? <p className="text-xs text-destructive">{errors[f.key]}</p> : null}
            </div>
          ))}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="seller-footer_note" className="text-xs">Note at the bottom of every invoice (optional)</Label>
            <Textarea
              id="seller-footer_note"
              dir="auto"
              rows={2}
              value={form.footer_note}
              maxLength={SELLER_LIMITS.footer_note}
              aria-invalid={!!errors.footer_note}
              onChange={(e) => setField('footer_note', e.target.value)}
            />
            {errors.footer_note ? <p className="text-xs text-destructive">{errors.footer_note}</p> : null}
          </div>
        </div>
        {!cleanBillingText(form.tax_number) ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">No tax registration number is set yet. Ask your accountant whether your invoices must show it.</p>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={!dirty || save.isPending} onClick={submit} className="gap-1.5">
            {save.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null} Save seller details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

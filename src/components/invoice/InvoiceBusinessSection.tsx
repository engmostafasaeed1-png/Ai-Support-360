import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Building2, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTenant } from '@/contexts/TenantContext';
import { useReissueInvoice, useTenantBillingDetails } from '@/hooks/useBusinessInvoice';
import {
  EMPTY_BILLING_FORM,
  billingDetailsComplete,
  buyerAddressLines,
  buyerMatchesForm,
  toBuyerDetails,
} from '@/lib/businessInvoice';

type PaymentLike = {
  id: string;
  status?: string;
  tenant_id?: string | null;
  buyer_details?: unknown;
  buyer_details_revision?: number | null;
  buyer_details_at?: string | null;
};

interface Props {
  payment: PaymentLike;
  hideHeading?: boolean;
  /** Opens the dialog where the business details of the company are entered (on the Payments page). */
  onEditDetails: () => void;
}

/** In the details of an invoice: who it is billed to, the link to the printable invoice, and the button that re-issues it with the business details. */
export default function InvoiceBusinessSection({ payment, onEditDetails, hideHeading = false }: Props) {
  const { tenant, isOwnerOrAdmin } = useTenant();
  const detailsQ = useTenantBillingDetails(tenant?.id);
  const reissue = useReissueInvoice();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const buyer = toBuyerDetails(payment.buyer_details);
  const revision = Number(payment.buyer_details_revision ?? 0);
  const saved = detailsQ.data?.form ?? EMPTY_BILLING_FORM;
  const complete = billingDetailsComplete(saved);
  const linked = !!tenant && payment.tenant_id === tenant.id;
  const upToDate = buyerMatchesForm(buyer, saved);
  const paid = payment.status === 'completed' || payment.status === 'paid';
  const issuedAt = payment.buyer_details_at ? new Date(payment.buyer_details_at) : null;

  let action: ReactNode = null;
  let hint: string | null = null;
  if (tenant && !detailsQ.isLoading) {
    if (!linked) {
      hint = 'This invoice is not linked to a company, so business details can not be added to it.';
    } else if (!complete) {
      hint = isOwnerOrAdmin
        ? 'Add the business details of your company (name, address and country) to issue this invoice as a business invoice.'
        : 'Ask an owner or an administrator of your company to add the business details. Then you can issue this invoice with them.';
      action = isOwnerOrAdmin ? <Button size="sm" onClick={onEditDetails}>Add business details</Button> : null;
    } else if (upToDate) {
      hint = 'This invoice already has the current business details of your company.';
    } else {
      action = (
        <Button size="sm" disabled={reissue.isPending} onClick={() => setConfirmOpen(true)}>
          {buyer ? 'Update to my current business details' : 'Issue with my business details'}
        </Button>
      );
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      {!hideHeading && <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
        <Building2 aria-hidden="true" className="h-3 w-3" /> Billed to
      </p>}
      {buyer ? (
        <div className="space-y-0.5 text-sm">
          <p dir="auto" className="font-medium text-foreground">{buyer.business_name}</p>
          {buyerAddressLines(buyer).map((line, i) => (
            <p key={`${i}-${line}`} dir="auto" className="text-muted-foreground">{line}</p>
          ))}
          {buyer.tax_number ? <p dir="auto" className="text-muted-foreground">Tax number: {buyer.tax_number}</p> : null}
          <p className="text-xs text-muted-foreground">
            Revision {revision}
            {issuedAt && !Number.isNaN(issuedAt.getTime()) ? ` · ${format(issuedAt, 'MMM d, yyyy')}` : ''}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This invoice is issued to you personally. It has no business details.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to={`/invoice/${payment.id}`}>
            <Printer aria-hidden="true" className="h-4 w-4" /> View / print invoice
          </Link>
        </Button>
        {action}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <p className="text-[11px] text-muted-foreground">
        The PDF of "Download Invoice" is the short version. "View / print invoice" opens the full invoice with the details of the seller and of the customer,
        also in Arabic. Choose "Save as PDF" in the print window to get a file.
      </p>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{buyer ? 'Update this invoice?' : 'Issue this invoice with your business details?'}</DialogTitle>
            <DialogDescription>
              The invoice number and the amounts stay the same. The invoice is re-issued as revision {revision + 1} with the details below as the customer.
              {paid ? ' The invoice is already paid and stays paid.' : ''} Nobody is notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-0.5 rounded-lg bg-muted/40 p-3 text-sm">
            <p dir="auto" className="font-medium text-foreground">{saved.business_name}</p>
            {[saved.address_line, [saved.city, saved.postal_code].filter(Boolean).join(' '), saved.country].filter(Boolean).map((line, i) => (
              <p key={`${i}-${line}`} dir="auto" className="text-muted-foreground">{line}</p>
            ))}
            {saved.tax_number ? <p dir="auto" className="text-muted-foreground">Tax number: {saved.tax_number}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              disabled={reissue.isPending}
              onClick={() => reissue.mutate(payment.id, { onSettled: () => setConfirmOpen(false) })}
              className="gap-1.5"
            >
              {reissue.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null} {buyer ? 'Update the invoice' : 'Issue the invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

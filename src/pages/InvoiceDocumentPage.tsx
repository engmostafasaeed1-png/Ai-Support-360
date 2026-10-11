import { useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { format } from 'date-fns';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInvoiceDocument } from '@/hooks/useBusinessInvoice';
import {
  breakdownRows,
  buyerAddressLines,
  buyerFacts,
  formatInvoiceMoney,
  invoiceFileTitle,
  revisionLine,
  sellerAddressLines,
  sellerFacts,
  statusLabel,
  type InvoiceDocument,
} from '@/lib/businessInvoice';

// When the person prints, everything except the invoice sheet is hidden (the chat bubble, the buttons, the menus).
const PRINT_CSS = `
@page { size: A4; margin: 14mm; }
@media print {
  html, body { background: #ffffff !important; }
  body * { visibility: hidden !important; }
  #invoice-sheet, #invoice-sheet * { visibility: visible !important; }
  #invoice-sheet { position: absolute; left: 0; right: 0; top: 0; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
}
`;

const STATUS_STYLE: Record<string, string> = {
  completed: 'border-green-300 bg-green-50 text-green-800',
  paid: 'border-green-300 bg-green-50 text-green-800',
  pending: 'border-amber-300 bg-amber-50 text-amber-800',
  refunded: 'border-gray-300 bg-gray-100 text-gray-700',
  failed: 'border-red-300 bg-red-50 text-red-800',
  disputed: 'border-red-300 bg-red-50 text-red-800',
};

const dateText = (iso: string | null): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, 'MMM d, yyyy');
};

export default function InvoiceDocumentPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useInvoiceDocument(paymentId);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={goBack}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" /> Back
        </Button>
        {data?.ok ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">To get a PDF file choose "Save as PDF" in the print window.</span>
            <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
              <Printer aria-hidden="true" className="h-4 w-4" /> Print / Save as PDF
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton className="mx-auto h-[640px] max-w-[820px] rounded-xl" />
      ) : data?.ok ? (
        <InvoiceSheet doc={data.doc} />
      ) : (
        <div className="mx-auto max-w-[820px] rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-base font-semibold text-foreground">
            {data && !data.ok && data.reason === 'not_found' ? 'This invoice does not exist' : 'You can not open this invoice'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {data && !data.ok && data.reason === 'not_found'
              ? 'Check the link, or open the invoice from your Payments page.'
              : error instanceof Error
                ? error.message
                : 'Only the customer of the invoice and the administrators of the platform can open it. Sign in with the right account.'}
          </p>
        </div>
      )}
    </div>
  );
}

function InvoiceSheet({ doc }: { doc: InvoiceDocument }) {
  const seller = doc.seller;
  const buyer = doc.buyer.type === 'business' ? doc.buyer.details : null;
  const rows = breakdownRows(doc);
  const money = (n: number) => formatInvoiceMoney(n, doc.currency);
  const statusStyle = STATUS_STYLE[doc.status] ?? STATUS_STYLE.pending;
  const sellerLines = sellerAddressLines(seller);
  const sellerExtra = sellerFacts(seller);

  return (
    <article id="invoice-sheet" className="mx-auto max-w-[820px] rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-900 shadow-sm sm:p-10">
      <Helmet>
        <title>{invoiceFileTitle(doc)}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-gray-200 pb-6">
        <div className="min-w-0 space-y-0.5">
          <p dir="auto" className="text-xl font-bold text-gray-900">{seller.legal_name || 'AI Support 360'}</p>
          {seller.legal_name_ar ? <p dir="rtl" lang="ar" className="text-base font-semibold text-gray-800">{seller.legal_name_ar}</p> : null}
          {sellerLines.map((line, i) => (
            <p key={`${i}-${line}`} dir="auto" className="text-gray-600">{line}</p>
          ))}
          {sellerExtra.map((f) => (
            <p key={f.label} dir="auto" className="text-gray-600">
              <span className="text-gray-500">{f.label}: </span>{f.value}
            </p>
          ))}
        </div>
        <div className="text-end">
          <p className="text-3xl font-bold tracking-wide text-gray-800">INVOICE</p>
          <p className="font-mono text-sm text-gray-700">{doc.invoice_number}</p>
          {doc.revision >= 1 ? <p className="mt-1 text-xs font-medium text-gray-600">Revision {doc.revision}</p> : null}
          <span className={`mt-2 inline-block rounded-full border px-3 py-0.5 text-xs font-semibold ${statusStyle}`}>{statusLabel(doc.status)}</span>
        </div>
      </header>

      <section className="grid gap-6 border-b border-gray-200 py-6 sm:grid-cols-2">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bill to</p>
          {buyer ? (
            <>
              <p dir="auto" className="text-base font-semibold text-gray-900">{buyer.business_name}</p>
              {buyerAddressLines(buyer).map((line, i) => (
                <p key={`${i}-${line}`} dir="auto" className="text-gray-600">{line}</p>
              ))}
              {buyerFacts(buyer).map((f) => (
                <p key={f.label} dir="auto" className="text-gray-600">
                  <span className="text-gray-500">{f.label}: </span>{f.value}
                </p>
              ))}
            </>
          ) : (
            <>
              <p dir="auto" className="text-base font-semibold text-gray-900">{doc.buyer.name || 'Customer'}</p>
              {doc.buyer.email ? <p dir="auto" className="text-gray-600">{doc.buyer.email}</p> : null}
            </>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 self-start text-gray-700">
          <dt className="text-gray-500">Issue date</dt>
          <dd className="font-medium">{dateText(doc.issued_at)}</dd>
          <dt className="text-gray-500">Due date</dt>
          <dd className="font-medium">{dateText(doc.due_date)}</dd>
          {doc.paid_at ? (
            <>
              <dt className="text-gray-500">Paid on</dt>
              <dd className="font-medium">{dateText(doc.paid_at)}</dd>
            </>
          ) : null}
          {doc.payment_method ? (
            <>
              <dt className="text-gray-500">Payment method</dt>
              <dd className="font-medium capitalize">{doc.payment_method.replace(/_/g, ' ')}</dd>
            </>
          ) : null}
          {doc.currency ? (
            <>
              <dt className="text-gray-500">Currency</dt>
              <dd className="font-medium">{doc.currency}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="space-y-1 border-b border-gray-200 py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Service</p>
        {doc.description ? <p dir="auto" className="text-gray-900">{doc.description}</p> : null}
        {doc.ticket_title ? (
          <p dir="auto" className="text-gray-600">
            Ticket: {doc.ticket_title}{doc.ticket_module ? ` (${doc.ticket_module})` : ''}
          </p>
        ) : null}
        {doc.consultant_name ? <p dir="auto" className="text-gray-600">Consultant: {doc.consultant_name}</p> : null}
        {!doc.description && !doc.ticket_title && !doc.consultant_name ? <p className="text-gray-600">Services of the platform</p> : null}
      </section>

      <section className="py-6">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-gray-100">
                <td className="py-2 pe-4 text-gray-700">{r.label}</td>
                <td className="py-2 text-end tabular-nums text-gray-900">{money(r.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-4 pe-4 text-base font-bold text-gray-900">Total</td>
              <td className="pt-4 text-end text-base font-bold tabular-nums text-gray-900">{money(doc.amount)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer className="space-y-2 border-t border-gray-200 pt-4 text-xs text-gray-500">
        {seller.footer_note ? <p dir="auto">{seller.footer_note}</p> : null}
        {doc.revisions.length > 0 ? (
          <div>
            <p className="font-medium text-gray-600">History of the business details on this invoice</p>
            <ul className="list-inside list-disc">
              {doc.revisions.map((r) => (
                <li key={r.revision}>{revisionLine(r)} ({dateText(r.created_at)})</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>This invoice was generated by the platform.</p>
      </footer>
    </article>
  );
}

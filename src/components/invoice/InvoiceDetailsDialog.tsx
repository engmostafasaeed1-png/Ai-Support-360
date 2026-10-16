import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, CreditCard, DollarSign, FileText, Calendar, User, ArrowRight, Ticket, CheckCircle2, Video, MessageSquare, Monitor, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useConfirmPayment } from '@/hooks/useBilling';
import { PayInvoiceCard } from './PayInvoiceCard';
import InvoiceBusinessSection from './InvoiceBusinessSection';
import { PaymentStatusTimeline } from './PaymentStatusTimeline';
import { InvoiceDisputeSection } from './InvoiceDisputeSection';
import { ConvertedAmount } from '@/components/currency/ConvertedAmount';
import PriceBreakdown from '@/components/pricing/PriceBreakdown';
import { paymentBreakdown } from '@/lib/pricing';

const money = (value: number, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
const when = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? format(new Date(value), 'MMM d, yyyy') : '-';

interface Props {
  payment: any;
  onClose: () => void;
  onEditDetails: () => void;
  onDownload: () => void;
  status: { label: string; color: string; icon: any };
  billedActions?: React.ReactNode;
}

export function InvoiceDetailsDialog({ payment, onClose, onEditDetails, onDownload, status, billedActions }: Props) {
  const { i18n } = useTranslation();
  const admin = useIsAdmin();
  const paid = payment.status === 'completed' || payment.status === 'paid';
  const [sections, setSections] = useState<string[]>(paid ? ['timeline'] : []);
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bankReference, setBankReference] = useState('');
  const confirm = useConfirmPayment('Payment confirmed.');
  const confirming = useRef(false);
  const qc = useQueryClient();
  useEffect(() => {
    if (paid) setSections(current => current.includes('timeline') ? current : [...current, 'timeline']);
  }, [paid]);
  const StatusIcon = status.icon;
  const reportSummary = payment.client_reported_at ? `Reported by the client on ${when(payment.client_reported_at)}, reference ${payment.client_transfer_reference || '-'}` : null;
  const confirmReceived = () => {
    if (confirming.current || confirm.isPending || !bankReference.trim()) return;
    confirming.current = true;
    confirm.mutate({ id: payment.id, bankReference: bankReference.trim(), received: Number(payment.amount) }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['client-payments'] });
        void qc.invalidateQueries({ queryKey: ['invoice-document', payment.id] });
        setConfirmOpen(false);
      },
      onSettled: () => { confirming.current = false; },
    });
  };
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent dir={i18n.dir()} aria-describedby={undefined}
        className="flex h-[100dvh] max-h-[100dvh] !max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-none md:h-auto md:max-h-[92dvh] md:!max-w-4xl md:rounded-2xl"
        onOpenAutoFocus={event => { event.preventDefault(); const panel = document.querySelector('[data-invoice-details]'); panel?.querySelector<HTMLElement>('[data-invoice-body]')?.focus({ preventScroll: true }); }}
        data-invoice-details>
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pe-12 text-start md:px-5 md:pe-14">
          <DialogTitle className="break-words text-base">{payment.invoice}</DialogTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={`gap-1 ${status.color}`}><StatusIcon className="h-3.5 w-3.5" />{status.label}</Badge>
            <ConvertedAmount amount={Number(payment.amount)} currency={payment.currency} className="items-start text-2xl font-bold text-foreground" />
          </div>
        </DialogHeader>
        <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-5" data-invoice-body>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            <div className="min-w-0 space-y-2">
              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-0 text-[13px]">
                <DetailRow label="Consultant" value={payment.consultant} icon={User} />
                <DetailRow label="Date" value={payment.date} icon={Calendar} />
                <DetailRow label="Currency" value={payment.currency} icon={DollarSign} />
                <DetailRow label="VAT" value={money(Number(payment.vat || 0), payment.currency)} icon={FileText} />
                {payment.payment_method && payment.status !== 'pending' && (
                  <DetailRow label="Method" value={payment.payment_method} icon={CreditCard} />
                )}
                {payment.due_date && (
                  <DetailRow label="Due Date" value={format(new Date(payment.due_date), 'MMM d, yyyy')} icon={Calendar} />
                )}
              </div>

              {/* Description */}
              {payment.description && (
                <div className="rounded-lg bg-muted/30 p-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</p>
                  <p className="text-sm text-foreground">{payment.description}</p>
                </div>
              )}

              {/* Linked Session */}
              {payment.session_id && (
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-2">
                  <p className="text-xs font-semibold text-primary uppercase mb-1 flex items-center gap-1">
                    <SessionTypeIcon type={payment.session_type} className="w-3 h-3" /> Linked Session
                  </p>
                  <p className="text-sm font-medium text-foreground capitalize">
                    {(payment.session_type || 'session').toString().replace(/_/g, ' ')} session
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-muted-foreground">
                    {payment.session_status && (
                      <Badge variant="outline" className="text-[10px] capitalize">{payment.session_status}</Badge>
                    )}
                    {payment.session_scheduled_at && (
                      <span>{format(new Date(payment.session_scheduled_at), 'MMM d, yyyy h:mm a')}</span>
                    )}
                    {payment.session_duration_minutes ? (
                      <span>· {payment.session_duration_minutes} min</span>
                    ) : null}
                  </div>
                  <Link to={`/client/sessions/${payment.session_id}`} className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                    View Session <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}

              {/* Linked Ticket */}
              {payment.ticket_id && (
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-2">
                  <p className="text-xs font-semibold text-primary uppercase mb-1 flex items-center gap-1">
                    <Ticket className="w-3 h-3" /> Linked Ticket
                  </p>
                  <p className="text-sm font-medium text-foreground">{payment.ticket_title}</p>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {payment.ticket_sap_module && <Badge variant="secondary" className="text-[10px]">{payment.ticket_sap_module}</Badge>}
                    {payment.ticket_urgency && <Badge variant="outline" className="text-[10px]">{payment.ticket_urgency}</Badge>}
                  </div>
                  <Link to={`/client/tickets/${payment.ticket_id}`} className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                    View Ticket <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}

              {(() => {
                const breakdown = paymentBreakdown(payment);
                return breakdown && <PriceBreakdown breakdown={breakdown} currency={payment.currency} className="[&>div]:text-xs [&>div]:gap-y-0 [&>div>span]:py-1.5 [&>div>span]:text-end [&>div>span:nth-child(odd)]:text-start" />;
              })()}

            </div>
            <div className="min-w-0 border-t border-border pt-3 md:border-t-0 md:border-s md:ps-5 md:pt-0">
              <PayInvoiceCard payment={payment} compact actionsContainer={actionsContainer} canReport={!admin} />
            </div>
          </div>
          <Accordion type="multiple" value={sections} onValueChange={setSections} className="mt-3">
            <AccordionItem value="billing">
              <AccordionTrigger className="py-2 text-xs">Billed to</AccordionTrigger>
              <AccordionContent><InvoiceBusinessSection payment={payment} onEditDetails={onEditDetails} hideHeading />{billedActions}</AccordionContent>
            </AccordionItem>
            <AccordionItem value="timeline">
              <AccordionTrigger className="py-2 text-xs">Payment Timeline</AccordionTrigger>
              <AccordionContent><PaymentStatusTimeline payment={payment} hideHeading /></AccordionContent>
            </AccordionItem>
            <AccordionItem value="disputes">
              <AccordionTrigger className="py-2 text-xs">Disputes</AccordionTrigger>
              <AccordionContent forceMount>
                <div hidden={!sections.includes('disputes')}>
                <InvoiceDisputeSection payment={payment} hideHeading onDisputesLoaded={exists => {
                  if (exists) setSections(current => current.includes('disputes') ? current : [...current, 'disputes']);
                }} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <footer className="shrink-0 border-t border-border bg-background px-4 py-3 md:px-5" data-invoice-footer>
          {admin && !paid && reportSummary && <p className="mb-2 break-words text-xs text-muted-foreground">{reportSummary}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div ref={setActionsContainer} className="flex min-w-0 flex-1 flex-col gap-2 sm:items-start">
              {paid ? <span className="inline-flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-xs font-medium text-success"><CheckCircle2 className="h-4 w-4" />Paid on {when(payment.paid_at || payment.updated_at || payment.date)}</span> : admin && payment.status === 'pending' ? (
                <Button className="h-auto min-h-10 whitespace-normal py-2 text-xs" onClick={() => { setBankReference(payment.client_transfer_reference || ''); setConfirmOpen(true); }}>Confirm payment received</Button>
              ) : null}
            </div>
            <Button variant="outline" className="shrink-0 text-xs" onClick={onDownload}><Download className="h-4 w-4" />Download Invoice</Button>
          </div>
        </footer>
      </DialogContent>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent dir={i18n.dir()} className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm payment received</DialogTitle>
            <DialogDescription>Only confirm after you saw the money in the bank account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="break-words font-medium">{payment.invoice} · {money(Number(payment.amount), payment.currency)}</p>
            {reportSummary && <p className="break-words text-xs text-muted-foreground">{reportSummary}</p>}
            {payment.client_transfer_date && <p className="text-xs text-muted-foreground">Date of the transfer: {when(payment.client_transfer_date)}</p>}
            <Label htmlFor="invoice-bank-reference">Bank reference of the incoming transfer *</Label>
            <Input id="invoice-bank-reference" value={bankReference} onChange={e => setBankReference(e.target.value)} maxLength={120} placeholder="Reference shown in your bank statement" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button disabled={!bankReference.trim() || confirm.isPending} onClick={confirmReceived}>Confirm payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function DetailRow({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return <div className="flex min-w-0 items-start gap-2 py-1.5"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-[13px] font-medium text-foreground">{value}</p></div></div>;
}
function SessionTypeIcon({ type, className }: { type?: string | null; className?: string }) {
  const Icon = type === 'chat' ? MessageSquare : type === 'screen_share' ? Monitor : type === 'video' ? Video : PlayCircle;
  return <Icon className={className} />;
}

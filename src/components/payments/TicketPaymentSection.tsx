import { useQuery } from '@tanstack/react-query';
import { Loader2, Receipt, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PriceBreakdown from '@/components/pricing/PriceBreakdown';
import { paymentBreakdown } from '@/lib/pricing';
import { formatMoney } from '@/lib/timesheet';

type Role = 'consultant' | 'client' | 'viewer';
interface Milestone { title: string; percent: number }
interface Terms { term_type: string; net_days: number; deposit_percent: number; milestones: Milestone[] }
interface Invoice {
  id: string;
  invoice_number: string | null;
  status: string;
  amount: number;
  currency: string | null;
  vat_amount: number | null;
  due_date: string | null;
  created_at: string;
  paid_at: string | null;
  pricing_model: string | null;
  base_amount: number | null;
  service_fee_percent: number | null;
  service_fee_amount: number | null;
  processing_fee_percent: number | null;
  processing_fee_amount: number | null;
  vat_percent: number | null;
}

/** Older payment terms, kept for the places that still write them. */
export function termsLabel(t: Pick<Terms, 'term_type' | 'net_days' | 'deposit_percent' | 'milestones'>): string {
  switch (t.term_type) {
    case 'net': return `Net ${t.net_days} days`;
    case 'deposit': return `${t.deposit_percent}% deposit upfront, rest on completion`;
    case 'milestones': return `${t.milestones.length} milestones: ` + t.milestones.map(m => `${m.title} (${m.percent}%)`).join(', ');
    default: return 'Due on receipt';
  }
}

const statusInfo = (status: string): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } => {
  switch (status) {
    case 'completed': return { label: 'Paid', variant: 'default' };
    case 'pending': return { label: 'Waiting for payment', variant: 'secondary' };
    case 'refunded': return { label: 'Refunded', variant: 'destructive' };
    case 'disputed': return { label: 'Disputed', variant: 'destructive' };
    default: return { label: status.replace(/_/g, ' '), variant: 'outline' };
  }
};

interface Props { ticketId: string; role: Role; currency?: string }

/**
 * The invoices of a ticket. The platform makes an invoice when the client approves a timesheet: the fee of the consultant (approved hours x approved hourly rate)
 * plus the platform service fee and the payment processing fee, plus VAT. The client pays it in Payments & Invoices; the consultant gets the whole fee.
 */
export default function TicketPaymentSection({ ticketId, role }: Props) {
  const { data: invoices = [], isLoading: loading } = useQuery({
    queryKey: ['ticket-payment-invoices', ticketId],
    queryFn: async (): Promise<Invoice[]> => {
      const { data } = await supabase
        .from('payments')
        .select('id, invoice_number, status, amount, currency, vat_amount, due_date, created_at, paid_at, pricing_model, base_amount, service_fee_percent, service_fee_amount, processing_fee_percent, processing_fee_amount, vat_percent')
        .eq('ticket_id', ticketId)
        .eq('kind', 'invoice')
        .order('created_at', { ascending: false });
      return (data as unknown as Invoice[]) ?? [];
    },
  });

  return (
    <Card className="rounded-2xl border-border/50 shadow-sm" data-testid="ticket-payment-section">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Invoices</CardTitle>
        <p className="text-xs text-muted-foreground">
          An invoice is made automatically when the client approves a timesheet: the consultant fee plus the platform service fee and the payment processing fee, plus VAT.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoice yet. It appears here when the client approves a timesheet.</p>
        ) : invoices.map(inv => {
          const info = statusInfo(inv.status);
          const cur = inv.currency || 'USD';
          const breakdown = paymentBreakdown(inv);
          return (
            <div key={inv.id} className="space-y-2 rounded-xl border border-border/50 p-3" data-testid="ticket-invoice">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium"><Receipt className="h-4 w-4 text-primary" />{inv.invoice_number ?? 'Invoice'}</span>
                <Badge variant={info.variant}>{info.label}</Badge>
              </div>
              {breakdown ? (
                <PriceBreakdown breakdown={breakdown} currency={cur} audience={role === 'consultant' ? 'consultant' : 'client'} />
              ) : (
                <p className="text-sm">Total <strong>{formatMoney(inv.amount, cur)}</strong>{Number(inv.vat_amount) > 0 ? ` (VAT ${formatMoney(inv.vat_amount, cur)})` : ''}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Created {format(new Date(inv.created_at), 'PP')}
                {inv.status === 'completed' && inv.paid_at ? `, paid ${format(new Date(inv.paid_at), 'PP')}` : inv.due_date ? `, due ${format(new Date(inv.due_date), 'PP')}` : ''}
              </p>
              {role === 'client' && inv.status === 'pending' && (
                <Button size="sm" asChild><Link to="/client/payments">Pay in Payments &amp; Invoices</Link></Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  ReceiptText, User, Calendar, DollarSign, FileText, CreditCard, Ticket,
  ArrowRight, Hash, Copy, Video, MessageSquare, Monitor, PlayCircle, Phone,
  HelpCircle, Clock, Building2,
} from 'lucide-react';
import { PaymentStatusTimeline } from '@/components/invoice/PaymentStatusTimeline';
import { ConvertedAmount } from '@/components/currency/ConvertedAmount';

const SESSION_TYPE_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  video: { label: 'Video Call', icon: Video, className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300' },
  chat: { label: 'Chat', icon: MessageSquare, className: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300' },
  screen_share: { label: 'Screen Share', icon: Monitor, className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300' },
  voice: { label: 'Voice Call', icon: Phone, className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300' },
  recorded: { label: 'Recorded Session', icon: PlayCircle, className: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300' },
};

const fmt = (amount: number, currency: string = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

interface Props {
  payment: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentDetailsDrawer({ payment, open, onOpenChange }: Props) {
  if (!payment) return null;

  const sessionCfg = payment.session_type
    ? SESSION_TYPE_CONFIG[payment.session_type] || {
        label: payment.session_type.replace(/_/g, ' '),
        icon: PlayCircle,
        className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
      }
    : null;
  const SessionIcon = sessionCfg?.icon || HelpCircle;

  const transactionId = payment.transaction_id || payment.id;
  const shortId = String(transactionId).slice(0, 8).toUpperCase();

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="w-5 h-5 text-primary" />
            Payment Details
          </SheetTitle>
          <SheetDescription>
            {payment.invoice}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Amount header */}
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/5 to-transparent p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Amount</p>
            <ConvertedAmount
              amount={Number(payment.amount)}
              currency={payment.currency}
              className="items-start text-2xl font-bold text-foreground"
            />
            {Number(payment.vat) > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Includes VAT: {fmt(Number(payment.vat), payment.currency)}
              </p>
            )}
          </div>

          {/* Transaction ID */}
          <div className="rounded-xl border border-border/60 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
              <Hash className="w-3 h-3" /> Transaction ID
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-muted/50 rounded px-2 py-1.5 truncate" title={String(transactionId)}>
                {shortId}…
              </code>
              <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" onClick={() => copy(String(transactionId), 'Transaction ID')}>
                <Copy className="w-3 h-3" /> Copy
              </Button>
            </div>
            {payment.payment_method && payment.status !== 'pending' && (
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <CreditCard className="w-3 h-3" /> via {payment.payment_method}
              </p>
            )}
          </div>

          {/* Quick details */}
          <div className="grid grid-cols-2 gap-3">
            <Detail icon={User} label="Consultant" value={payment.consultant} />
            <Detail icon={Calendar} label="Date" value={payment.date} />
            <Detail icon={DollarSign} label="Currency" value={payment.currency} />
            <Detail icon={FileText} label="VAT" value={fmt(Number(payment.vat || 0), payment.currency)} />
            {payment.due_date && (
              <Detail icon={Clock} label="Due Date" value={format(new Date(payment.due_date), 'MMM d, yyyy')} />
            )}
            {payment.payment_method && payment.status !== 'pending' && (
              <Detail icon={Building2} label="Method" value={payment.payment_method} />
            )}
          </div>

          {/* Session Info */}
          {payment.session_id && sessionCfg && (
            <div className="rounded-xl border border-border/60 p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Session Info</p>
              <div className="flex items-center gap-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${sessionCfg.className}`}>
                  <SessionIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{sessionCfg.label}</p>
                  {payment.session_status && (
                    <Badge variant="outline" className="text-[10px] capitalize mt-0.5">{payment.session_status}</Badge>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground space-y-0.5 ps-1">
                {payment.session_scheduled_at && (
                  <p className="inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Scheduled {format(new Date(payment.session_scheduled_at), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
                {payment.session_duration_minutes && (
                  <p className="inline-flex items-center gap-1 ms-3">
                    <Clock className="w-3 h-3" /> {payment.session_duration_minutes} min
                  </p>
                )}
              </div>
              <Link
                to={`/client/sessions/${payment.session_id}`}
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open session <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          {/* Linked Ticket */}
          {payment.ticket_id && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-[10px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1 mb-1">
                <Ticket className="w-3 h-3" /> Linked Ticket
              </p>
              <p className="text-sm font-medium text-foreground">{payment.ticket_title}</p>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {payment.ticket_sap_module && <Badge variant="secondary" className="text-[10px]">{payment.ticket_sap_module}</Badge>}
                {payment.ticket_urgency && <Badge variant="outline" className="text-[10px]">{payment.ticket_urgency}</Badge>}
              </div>
              <Link
                to={`/client/tickets/${payment.ticket_id}`}
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
              >
                View ticket <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          {/* Description */}
          {payment.description && (
            <div className="rounded-xl bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Description</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{payment.description}</p>
            </div>
          )}

          <Separator />

          {/* Payment Timeline */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Payment Timeline</p>
            <PaymentStatusTimeline payment={payment} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Detail({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium text-foreground truncate" title={value}>{value}</p>
      </div>
    </div>
  );
}

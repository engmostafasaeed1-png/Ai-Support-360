import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClientPayments } from '@/hooks/useClientPayments';
import { Download, CreditCard, DollarSign, FileText, Clock, Search, ArrowRight, Ticket, AlertCircle, CheckCircle2, XCircle, ReceiptText, Calendar, User, Tag, Video, MessageSquare, Monitor, PlayCircle, Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { generateInvoicePdf } from '@/lib/invoicePdf';
import { generateReceiptPdf } from '@/lib/receiptPdf';
import { PaymentStatusTimeline } from '@/components/invoice/PaymentStatusTimeline';
import { ConvertedAmount } from '@/components/currency/ConvertedAmount';
import { CurrencySelector } from '@/components/currency/CurrencySelector';
import { useCurrency, formatMoney } from '@/contexts/CurrencyContext';

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  completed: { label: 'Paid', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  paid: { label: 'Paid', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  refunded: { label: 'Refunded', color: 'bg-muted text-muted-foreground', icon: AlertCircle },
};

export default function PaymentsPage() {
  const { data: payments, isLoading } = useClientPayments();
  const [search, setSearch] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [tab, setTab] = useState('all');

  const allPayments = payments || [];
  const { preferred, convert, isLoading: ratesLoading } = useCurrency();
  const sumConverted = (filterFn: (p: any) => boolean, field: 'amount' | 'vat' = 'amount') => {
    let total = 0;
    let allConverted = true;
    for (const p of allPayments) {
      if (!filterFn(p)) continue;
      const v = Number((p as any)[field] || 0);
      const c = convert(v, p.currency || 'USD');
      if (c === null) { allConverted = false; continue; }
      total += c;
    }
    return { total, allConverted };
  };
  const paidSum = sumConverted((p) => p.status === 'completed' || p.status === 'paid');
  const pendingSum = sumConverted((p) => p.status === 'pending');
  const vatSum = sumConverted(() => true, 'vat');

  const filtered = allPayments.filter(p => {
    const matchSearch = !search || 
      p.invoice?.toLowerCase().includes(search.toLowerCase()) ||
      p.consultant?.toLowerCase().includes(search.toLowerCase()) ||
      p.ticket_title?.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase());
    const matchTab = tab === 'all' || 
      (tab === 'paid' && (p.status === 'completed' || p.status === 'paid')) ||
      (tab === 'pending' && p.status === 'pending') ||
      (tab === 'overdue' && p.status === 'failed');
    return matchSearch && matchTab;
  });

  const formatCurrency = (amount: number, currency: string = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <ReceiptText className="w-6 h-6 text-primary" /> Payments & Invoices
        </h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Track payments linked to your tickets and download invoices.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Spent', value: formatMoney(paidSum.total, preferred), icon: DollarSign, color: 'bg-accent/10 text-accent', approx: !paidSum.allConverted },
          { label: 'Pending', value: formatMoney(pendingSum.total, preferred), icon: Clock, color: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400', approx: !pendingSum.allConverted },
          { label: 'Total VAT', value: formatMoney(vatSum.total, preferred), icon: FileText, color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400', approx: !vatSum.allConverted },
          { label: 'Transactions', value: allPayments.length.toString(), icon: CreditCard, color: 'bg-primary/10 text-primary', approx: false },
        ].map((k, i) => (
          <Card key={i} className="rounded-2xl border-border/50">
            <CardContent className="p-5">
              <div className={`w-10 h-10 rounded-xl ${k.color} flex items-center justify-center mb-3`}>
                <k.icon className="w-5 h-5" />
              </div>
              {isLoading || ratesLoading ? <Skeleton className="h-7 w-20" /> : (
                <div className="text-xl font-bold text-foreground">{k.approx ? '≈ ' : ''}{k.value}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by invoice, consultant, ticket..." value={search} onChange={e => setSearch(e.target.value)} className="ps-9 rounded-xl" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-9">
              <TabsTrigger value="all" className="text-xs">All ({allPayments.length})</TabsTrigger>
              <TabsTrigger value="paid" className="text-xs">Paid</TabsTrigger>
              <TabsTrigger value="pending" className="text-xs">Pending</TabsTrigger>
            </TabsList>
          </Tabs>
          <CurrencySelector />
        </div>
      </div>

      {/* Payment List */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payments found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((payment: any) => {
                const sc = statusConfig[payment.status] || statusConfig.pending;
                const StatusIcon = sc.icon;
                return (
                  <div
                    key={payment.id}
                    onClick={() => setSelectedPayment(payment)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-muted/20 border border-border/30 hover:border-primary/30 hover:shadow-premium transition-all cursor-pointer"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <ReceiptText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{payment.invoice}</p>
                          <Badge variant="secondary" className={`text-[10px] gap-1 ${sc.color}`}>
                            <StatusIcon className="w-3 h-3" /> {sc.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="inline-flex items-center gap-1"><User className="w-3 h-3" /> {payment.consultant}</span>
                          <span className="mx-2">·</span>
                          <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {payment.date}</span>
                        </p>
                        {payment.ticket_title && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <Ticket className="w-3 h-3 text-primary" />
                            <span className="text-xs text-primary font-medium truncate">{payment.ticket_title}</span>
                            {payment.ticket_sap_module && (
                              <Badge variant="outline" className="text-[9px]">{payment.ticket_sap_module}</Badge>
                            )}
                          </div>
                        )}
                        {payment.session_id && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <SessionTypeIcon type={payment.session_type} className="w-3 h-3 text-blue-600" />
                            <span className="text-xs text-blue-600 font-medium capitalize">
                              {(payment.session_type || 'session').toString().replace(/_/g, ' ')} session
                            </span>
                            {payment.session_status && (
                              <Badge variant="outline" className="text-[9px] capitalize">{payment.session_status}</Badge>
                            )}
                            {payment.session_scheduled_at && (
                              <span className="text-[10px] text-muted-foreground">
                                · {format(new Date(payment.session_scheduled_at), 'MMM d, h:mm a')}
                              </span>
                            )}
                          </div>
                        )}
                        {payment.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{payment.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 justify-between sm:justify-end shrink-0">
                      <div className="text-start sm:text-end">
                        <ConvertedAmount amount={Number(payment.amount)} currency={payment.currency} className="items-end text-sm font-bold text-foreground" />
                        {Number(payment.vat) > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">VAT: {formatCurrency(Number(payment.vat), payment.currency)}</p>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" title="Download Invoice" className="shrink-0" onClick={e => { e.stopPropagation(); generateInvoicePdf(payment); }}>
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedPayment} onOpenChange={() => setSelectedPayment(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-primary" />
              {selectedPayment?.invoice}
            </DialogTitle>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-4">
              {/* Status */}
              <div className="flex items-center gap-2">
                {(() => {
                  const sc = statusConfig[selectedPayment.status] || statusConfig.pending;
                  const Icon = sc.icon;
                  return <Badge className={`gap-1 ${sc.color}`}><Icon className="w-3.5 h-3.5" /> {sc.label}</Badge>;
                })()}
                <ConvertedAmount amount={Number(selectedPayment.amount)} currency={selectedPayment.currency} className="ml-auto items-end text-lg font-bold text-foreground" />
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <DetailRow label="Consultant" value={selectedPayment.consultant} icon={User} />
                <DetailRow label="Date" value={selectedPayment.date} icon={Calendar} />
                <DetailRow label="Currency" value={selectedPayment.currency} icon={DollarSign} />
                <DetailRow label="VAT" value={formatCurrency(Number(selectedPayment.vat || 0), selectedPayment.currency)} icon={FileText} />
                {selectedPayment.payment_method && (
                  <DetailRow label="Method" value={selectedPayment.payment_method} icon={CreditCard} />
                )}
                {selectedPayment.due_date && (
                  <DetailRow label="Due Date" value={format(new Date(selectedPayment.due_date), 'MMM d, yyyy')} icon={Calendar} />
                )}
              </div>

              {/* Description */}
              {selectedPayment.description && (
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</p>
                  <p className="text-sm text-foreground">{selectedPayment.description}</p>
                </div>
              )}

              {/* Linked Session */}
              {selectedPayment.session_id && (
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 p-3">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase mb-1 flex items-center gap-1">
                    <SessionTypeIcon type={selectedPayment.session_type} className="w-3 h-3" /> Linked Session
                  </p>
                  <p className="text-sm font-medium text-foreground capitalize">
                    {(selectedPayment.session_type || 'session').toString().replace(/_/g, ' ')} session
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-muted-foreground">
                    {selectedPayment.session_status && (
                      <Badge variant="outline" className="text-[10px] capitalize">{selectedPayment.session_status}</Badge>
                    )}
                    {selectedPayment.session_scheduled_at && (
                      <span>{format(new Date(selectedPayment.session_scheduled_at), 'MMM d, yyyy h:mm a')}</span>
                    )}
                    {selectedPayment.session_duration_minutes ? (
                      <span>· {selectedPayment.session_duration_minutes} min</span>
                    ) : null}
                  </div>
                  <Link to={`/client/sessions/${selectedPayment.session_id}`} className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 mt-2 hover:underline">
                    View Session <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}

              {/* Linked Ticket */}
              {selectedPayment.ticket_id && (
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                  <p className="text-xs font-semibold text-primary uppercase mb-1 flex items-center gap-1">
                    <Ticket className="w-3 h-3" /> Linked Ticket
                  </p>
                  <p className="text-sm font-medium text-foreground">{selectedPayment.ticket_title}</p>
                  <div className="flex gap-1.5 mt-1">
                    {selectedPayment.ticket_sap_module && <Badge variant="secondary" className="text-[10px]">{selectedPayment.ticket_sap_module}</Badge>}
                    {selectedPayment.ticket_urgency && <Badge variant="outline" className="text-[10px]">{selectedPayment.ticket_urgency}</Badge>}
                  </div>
                  <Link to={`/client/tickets/${selectedPayment.ticket_id}`} className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                    View Ticket <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}

              <PaymentStatusTimeline payment={selectedPayment} />

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 gap-1.5 gradient-primary border-0" size="sm" onClick={() => generateInvoicePdf(selectedPayment)}>
                  <Download className="w-4 h-4" /> Download Invoice
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div>
        <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function SessionTypeIcon({ type, className }: { type?: string | null; className?: string }) {
  const Icon = type === 'chat' ? MessageSquare : type === 'screen_share' ? Monitor : type === 'video' ? Video : PlayCircle;
  return <Icon className={className} />;
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, CheckCircle2, CreditCard, Plus, ShieldCheck, Wallet, XCircle } from 'lucide-react';
import {
  useAdminInvoices, useAdminPayouts, useBankAccountLog, useBankTransferCompanies, useBillingPeople, useClientTicketsForInvoice, useConfirmPayment,
  useConsultantPayoutDetails, useCreateInvoice, useInvoiceBankAccounts, useInvoiceBankGrants, usePaymentSettings, useRejectReport, useSavePaymentSetting,
  usePaymobStatus, useProviderEvents, useSetPayoutStatus, useVerifyPayoutDetails, type BankDetails, type ProviderEvent,
} from '@/hooks/useBilling';
import { deadlineSummary, payoutDeadline, type DeadlineTone } from '@/lib/payoutDeadline';
import PricingSettingsCard from '@/components/admin/PricingSettingsCard';
import InvoiceSellerCard from '@/components/admin/InvoiceSellerCard';
import BankTransferSettingsCard from '@/components/admin/BankTransferSettingsCard';
import InvoiceBankControls, { type InvoiceBankControlsInvoice } from '@/components/admin/InvoiceBankControls';

const money = (n: number | string | null | undefined, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(n ?? 0));
  } catch {
    return `${Number(n ?? 0).toFixed(2)} ${currency}`;
  }
};

const when = (d?: string | null) => (d ? format(new Date(d), 'MMM d, yyyy HH:mm') : '-');

const invoiceVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default', pending: 'secondary', refunded: 'destructive', disputed: 'destructive',
};
const payoutVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default', processing: 'secondary', pending: 'outline', failed: 'destructive',
};
const deadlineClass: Record<DeadlineTone, string> = {
  done: 'text-green-700',
  ok: 'text-muted-foreground',
  soon: 'text-amber-700 font-medium',
  overdue: 'text-destructive font-semibold',
};

export default function PaymentsAdminPage() {
  const invoicesQ = useAdminInvoices();
  const payoutsQ = useAdminPayouts();
  const settingsQ = usePaymentSettings();
  const setPayout = useSetPayoutStatus();

  const [confirmFor, setConfirmFor] = useState<any>(null);
  const [rejectFor, setRejectFor] = useState<any>(null);
  const [payoutDialog, setPayoutDialog] = useState<{ payout: any; status: 'completed' | 'failed' } | null>(null);
  const [detailsFor, setDetailsFor] = useState<any>(null);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<InvoiceBankControlsInvoice | null>(null);
  const grantsQ = useInvoiceBankGrants();
  const accountsQ = useInvoiceBankAccounts();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const invoices: any[] = invoicesQ.data ?? [];
  const payouts: any[] = payoutsQ.data ?? [];

  const toConfirm = useMemo(
    () =>
      invoices
        .filter((i) => i.status === 'pending')
        .sort((a, b) => (b.client_reported_at ? 1 : 0) - (a.client_reported_at ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at))),
    [invoices],
  );
  const payoutsOpen = payouts.filter((p) => p.status === 'pending' || p.status === 'processing');
  const deadlines = deadlineSummary(payouts);
  // the payouts that are still owed first (the one that is due first on top), then the paid ones, newest first
  const payoutsSorted = [...payouts].sort((a, b) => {
    const aOpen = a.status !== 'completed';
    const bOpen = b.status !== 'completed';
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) return String(a.due_by ?? '9999-12-31').localeCompare(String(b.due_by ?? '9999-12-31'));
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  const filteredInvoices = invoices.filter((i) => {
    const q = search.trim().toLowerCase();
    const matchesText = !q || [i.invoice_number, i.reference, i.client_name, i.consultant_name, i.description].some((v) => String(v ?? '').toLowerCase().includes(q));
    return matchesText && (statusFilter === 'all' || i.status === statusFilter);
  });

  const commissionNow = settingsQ.data?.commission;
  const serviceFeesEarned = invoices
    .filter((i) => i.status === 'completed' && i.pricing_model === 'v2')
    .reduce((sum, i) => sum + Number(i.service_fee_amount || 0), 0);
  const feeCurrency = invoices.find((i) => i.pricing_model === 'v2')?.currency || 'USD';
  const setupMissing = !!settingsQ.data && (settingsQ.data.serviceFee === null || settingsQ.data.processingFee === null || settingsQ.data.vat === null || (!settingsQ.data.bank.iban && !settingsQ.data.bank.account_number));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" /> Payments & payouts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clients pay the platform by card (Visa, Mastercard; confirmed automatically). Bank transfer is optional: you allow it for a company or for one invoice, and you confirm that the money arrived. Then you pay the consultant their whole fee within 15 business days (Sunday to Thursday) of receiving the client's payment. The platform service fee, the payment processing fee and the VAT are paid by the client on top of the fee.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setNewInvoiceOpen(true)}>
          <Plus className="w-4 h-4" /> New invoice
        </Button>
      </div>

      {setupMissing && (
        <Card className="rounded-2xl border-amber-300 bg-amber-50/60">
          <CardContent className="p-4 flex items-start gap-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Finish the set-up in the Settings tab first: the three percentages of the price (platform service fee, payment processing fee, VAT)
              {' '}and the bank details your clients should pay into.
            </span>
          </CardContent>
        </Card>
      )}

      {(deadlines.overdue > 0 || deadlines.soon > 0) && (
        <Card className={deadlines.overdue > 0 ? 'rounded-2xl border-destructive/40 bg-destructive/5' : 'rounded-2xl border-amber-300 bg-amber-50/60'}>
          <CardContent className={`p-4 flex items-start gap-3 text-sm ${deadlines.overdue > 0 ? 'text-destructive' : 'text-amber-900'}`}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              {deadlines.overdue > 0 && (
                <p className="font-semibold">{`${deadlines.overdue} ${deadlines.overdue === 1 ? 'payout is late' : 'payouts are late'}`}</p>
              )}
              {deadlines.soon > 0 && (
                <p>{`${deadlines.soon} ${deadlines.soon === 1 ? 'payout is' : 'payouts are'} due within 3 days`}</p>
              )}
              <p className="text-xs">The platform promises to pay every consultant within 15 business days of receiving the client's payment. Open the Payouts tab.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Invoices to confirm', value: toConfirm.length },
          { label: 'Reported by the client', value: toConfirm.filter((i) => i.client_reported_at).length },
          { label: 'Payouts to pay', value: payoutsOpen.length },
          { label: 'Service fees earned', value: money(serviceFeesEarned, feeCurrency) },
        ].map((k) => (
          <Card key={k.label} className="rounded-2xl border-border/50">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-foreground">{invoicesQ.isLoading || payoutsQ.isLoading ? <Skeleton className="h-8 w-16" /> : k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="confirm" className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1 flex-wrap h-auto">
          <TabsTrigger value="confirm" className="rounded-lg text-sm">To confirm ({toConfirm.length})</TabsTrigger>
          <TabsTrigger value="invoices" className="rounded-lg text-sm">All invoices</TabsTrigger>
          <TabsTrigger value="payouts" className="rounded-lg text-sm">Payouts ({payoutsOpen.length} open)</TabsTrigger>
          <TabsTrigger value="settings" className="rounded-lg text-sm">Settings</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ to confirm */}
        <TabsContent value="confirm">
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {invoicesQ.isLoading ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
              ) : toConfirm.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No invoice is waiting for a payment.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Consultant</TableHead>
                      <TableHead className="text-end">Amount</TableHead>
                      <TableHead>Client says</TableHead>
                      <TableHead className="text-end">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {toConfirm.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{i.invoice_number}</div>
                          <div className="text-xs text-muted-foreground font-mono">{i.reference}</div>
                          {i.description && <div className="text-xs text-muted-foreground max-w-[220px] truncate">{i.description}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{i.client_name}</TableCell>
                        <TableCell className="text-sm">{i.consultant_name || '-'}</TableCell>
                        <TableCell className="text-end">
                          <div className="font-semibold">{money(i.amount, i.currency)}</div>
                          {i.pricing_model === 'v2' && i.base_amount != null && (
                            <div className="text-[11px] font-normal text-muted-foreground">
                              fee {money(i.base_amount, i.currency)} + service {money(i.service_fee_amount, i.currency)} + processing {money(i.processing_fee_amount, i.currency)} + VAT {money(i.vat_amount, i.currency)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {i.client_reported_at ? (
                            <div className="space-y-0.5">
                              <Badge variant="secondary" className="text-[10px]">Reported {when(i.client_reported_at)}</Badge>
                              <div>Transfer ref: <span className="font-mono">{i.client_transfer_reference}</span></div>
                              <div>Transfer date: {i.client_transfer_date}</div>
                              {i.client_note && <div className="text-muted-foreground">"{i.client_note}"</div>}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              Not reported yet{i.rejection_note ? ` (last answer: ${i.rejection_note})` : ''}
                            </span>
                          )}
                          {i.provider_status === 'initiated' && (
                            <div className="mt-1"><Badge variant="outline" className="text-[10px]">Card payment started {when(i.card_started_at)}</Badge></div>
                          )}
                          {i.provider_status === 'failed' && (
                            <div className="mt-1"><Badge variant="destructive" className="text-[10px]">Last card attempt failed</Badge></div>
                          )}
                        </TableCell>
                        <TableCell className="text-end whitespace-nowrap">
                          <Button size="sm" className="h-8 text-xs me-2" onClick={() => setConfirmFor(i)}>Confirm payment</Button>
                          {i.client_reported_at && (
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setRejectFor(i)}>Not found</Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 text-xs ms-2" onClick={() => setOptionsFor(i)}>Payment options</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ all invoices */}
        <TabsContent value="invoices" className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, reference, client, consultant..." className="max-w-sm rounded-xl" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Paid</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {invoicesQ.isLoading ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
              ) : filteredInvoices.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No invoices found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Consultant</TableHead>
<TableHead>Invoice page</TableHead>
                      <TableHead>Payment options</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead className="text-end">Amount</TableHead>
                      <TableHead className="text-end">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{i.invoice_number}</div>
                          <div className="text-xs text-muted-foreground font-mono">{i.reference}</div>
                        </TableCell>
                        <TableCell className="text-sm">{i.client_name}</TableCell>
                        <TableCell className="text-sm">{i.consultant_name || '-'}</TableCell>
<TableCell className="text-xs"><Link to={`/invoice/${i.id}`} className="text-primary hover:underline">View / print</Link></TableCell>
                        <TableCell className="text-xs">
                          {i.status === 'pending' ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap gap-1">
                                {grantsQ.data?.[i.id] && <Badge variant="secondary" className="text-[10px]">Bank transfer allowed</Badge>}
                                {accountsQ.data?.[i.id] && <Badge variant="outline" className="text-[10px]">Own bank account</Badge>}
                              </div>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOptionsFor(i)}>Payment options</Button>
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{when(i.created_at)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {i.paid_at ? <>{when(i.paid_at)}<div className="font-mono">{i.bank_reference}</div>{i.payment_method === 'card' && <Badge variant="outline" className="text-[10px] mt-0.5">Card</Badge>}</> : '-'}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="font-semibold">{money(i.amount, i.currency)}</div>
                          {i.pricing_model === 'v2' && i.base_amount != null && (
                            <div className="text-[11px] font-normal text-muted-foreground">
                              fee {money(i.base_amount, i.currency)} + service {money(i.service_fee_amount, i.currency)} + processing {money(i.processing_fee_amount, i.currency)} + VAT {money(i.vat_amount, i.currency)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <Badge variant={invoiceVariant[i.status] || 'outline'} className="text-[10px] capitalize">{i.status === 'completed' ? 'paid' : i.status}</Badge>
                          {(i.provider_status === 'refunded' || i.provider_status === 'voided') && (
                            <div className="mt-0.5"><Badge variant="destructive" className="text-[10px]">Card {i.provider_status}</Badge></div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ payouts */}
        <TabsContent value="payouts">
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              {payoutsQ.isLoading ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
              ) : payouts.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No payouts yet. A payout is created when you confirm a paid invoice that has a consultant.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultant</TableHead>
                      <TableHead className="text-end">Consultant fee (before commission)</TableHead>
                      <TableHead className="text-end">Commission</TableHead>
                      <TableHead className="text-end">To transfer</TableHead>
                      <TableHead>Due by</TableHead>
                      <TableHead>Bank details</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-end">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payoutsSorted.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">
                          <div className="font-medium">{p.consultant_name}</div>
                          <div className="text-xs text-muted-foreground">{when(p.created_at)}</div>
                        </TableCell>
                        <TableCell className="text-end text-sm">{p.gross_amount != null ? money(p.gross_amount, p.currency) : '-'}</TableCell>
                        <TableCell className="text-end text-sm">
                          {p.commission_amount != null ? (Number(p.commission_amount) === 0 ? 'none' : `${money(p.commission_amount, p.currency)} (${p.commission_percent}%)`) : '-'}
                        </TableCell>
<TableCell className="text-end font-semibold">{money(p.amount, p.currency)}</TableCell>
                        <TableCell className="text-xs">
                          {p.status === 'completed' ? (
                            '-'
                          ) : (
                            (() => {
                              const d = payoutDeadline(p);
                              return (
                                <>
                                  {p.due_by && <div className="font-medium text-foreground">{format(parseISO(p.due_by), 'MMM d, yyyy')}</div>}
                                  <div className={deadlineClass[d.tone]}>{d.label}</div>
                                </>
                              );
                            })()
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setDetailsFor(p)}>
                            {!p.has_details ? <Badge variant="destructive" className="text-[10px]">Missing</Badge>
                              : p.details_verified ? <Badge className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Verified</Badge>
                              : <Badge variant="secondary" className="text-[10px]">Not verified</Badge>}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Badge variant={payoutVariant[p.status] || 'outline'} className="text-[10px] capitalize">{p.status}</Badge>
                          {p.bank_reference && <div className="text-xs text-muted-foreground font-mono mt-0.5">{p.bank_reference}</div>}
                          {p.status === 'failed' && p.note && <div className="text-xs text-destructive mt-0.5 max-w-[200px]">{p.note}</div>}
                        </TableCell>
                        <TableCell className="text-end whitespace-nowrap">
                          {!p.has_details && p.status !== 'completed' && (
                            <p className="text-xs text-amber-700 dark:text-amber-400 max-w-[220px] ms-auto mb-1 text-end">
                              Consultant has not entered bank details yet — ask them to add them in Profile &gt; Payout details.
                            </p>
                          )}
                          {p.status === 'pending' && (
                            <Button size="sm" variant="outline" className="h-8 text-xs me-1" disabled={setPayout.isPending || !p.has_details} title={!p.has_details ? 'Consultant has not entered bank details yet' : undefined} onClick={() => setPayout.mutate({ id: p.id, status: 'processing' })}>Start</Button>
                          )}
                          {(p.status === 'pending' || p.status === 'processing') && (
                            <>
                              <Button size="sm" className="h-8 text-xs me-1" disabled={!p.has_details} title={!p.has_details ? 'Consultant has not entered bank details yet' : undefined} onClick={() => setPayoutDialog({ payout: p, status: 'completed' })}>Mark paid</Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPayoutDialog({ payout: p, status: 'failed' })}>Failed</Button>
                            </>
                          )}
                          {p.status === 'failed' && (
                            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={setPayout.isPending} onClick={() => setPayout.mutate({ id: p.id, status: 'pending' })}>Retry</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ settings */}
        <TabsContent value="settings">
          <div className="space-y-4">
            <PricingSettingsCard />
            <InvoiceSellerCard />
            <Card className="rounded-2xl border-border/50">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Invoice numbering</p>
                  <p className="text-xs text-muted-foreground">
                    See which number the next invoice gets and change the counter, for example to close a gap. It is in the Admin Console under Invoice Numbering.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/console/invoice-numbering">Open invoice numbering</Link>
                </Button>
              </CardContent>
            </Card>
            <BankTransferSettingsCard />
            <SettingsTab />
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmPaymentDialog invoice={confirmFor} onClose={() => setConfirmFor(null)} />
      <RejectReportDialog invoice={rejectFor} onClose={() => setRejectFor(null)} />
      <PayoutActionDialog state={payoutDialog} onClose={() => setPayoutDialog(null)} />
      <PayoutDetailsDialog payout={detailsFor} onClose={() => setDetailsFor(null)} />
      <NewInvoiceDialog open={newInvoiceOpen} onClose={() => setNewInvoiceOpen(false)} />
      <InvoiceBankControls invoice={optionsFor} onClose={() => setOptionsFor(null)} />
    </div>
  );
}

/* ================================================================== dialogs */

function ConfirmPaymentDialog({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const confirm = useConfirmPayment();
  const [bankRef, setBankRef] = useState('');
  const [received, setReceived] = useState('');
  useEffect(() => {
    if (invoice) { setBankRef(''); setReceived(String(invoice.amount ?? '')); }
  }, [invoice?.id]);
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm the payment</DialogTitle>
          <DialogDescription>
            Only confirm after you saw the money in the bank account. {invoice ? `${invoice.invoice_number}: ${money(invoice.amount, invoice.currency)} from ${invoice.client_name}.` : ''}
            {invoice?.consultant_name ? ` A payout for ${invoice.consultant_name} is created automatically.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Bank reference of the incoming transfer *</Label>
            <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="Reference shown in your bank statement" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Amount received</Label>
            <Input type="number" step="0.01" min="0" value={received} onChange={(e) => setReceived(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">It can not be lower than the invoice amount.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!bankRef.trim() || confirm.isPending}
            onClick={() => confirm.mutate({ id: invoice.id, bankReference: bankRef.trim(), received: received ? Number(received) : undefined }, { onSuccess: onClose })}
          >
            Confirm payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectReportDialog({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const reject = useRejectReport();
  const [note, setNote] = useState('');
  useEffect(() => { if (invoice) setNote(''); }, [invoice?.id]);
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer not found</DialogTitle>
          <DialogDescription>The client reported a transfer that you could not find. The client reads your answer and can report again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <Label className="text-xs">What did you check? *</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="No transfer of this amount with this reference arrived yet" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!note.trim() || reject.isPending} onClick={() => reject.mutate({ id: invoice.id, note: note.trim() }, { onSuccess: onClose })}>Send to the client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutActionDialog({ state, onClose }: { state: { payout: any; status: 'completed' | 'failed' } | null; onClose: () => void }) {
  const setPayout = useSetPayoutStatus();
  const [text, setText] = useState('');
  useEffect(() => { if (state) setText(''); }, [state?.payout?.id, state?.status]);
  const paid = state?.status === 'completed';
  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{paid ? 'Mark the payout as paid' : 'The payout failed'}</DialogTitle>
          <DialogDescription>
            {state ? `${state.payout.consultant_name}: ${money(state.payout.amount, state.payout.currency)}. ` : ''}
            {paid ? 'Enter the bank reference of the transfer you made. The consultant is told.' : 'Write the reason. The consultant reads it (for example: IBAN rejected by the bank).'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <Label className="text-xs">{paid ? 'Bank reference of your transfer *' : 'Reason *'}</Label>
          {paid ? (
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} />
          ) : (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!text.trim() || setPayout.isPending}
            onClick={() => setPayout.mutate(
              paid ? { id: state!.payout.id, status: 'completed', bankReference: text.trim() } : { id: state!.payout.id, status: 'failed', note: text.trim() },
              { onSuccess: onClose },
            )}
          >
            {paid ? 'Mark as paid' : 'Mark as failed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutDetailsDialog({ payout, onClose }: { payout: any; onClose: () => void }) {
  const detailsQ = useConsultantPayoutDetails(payout?.consultant_id ?? null);
  const verify = useVerifyPayoutDetails();
  const d = detailsQ.data;
  const row = (label: string, value?: string | null) => (
    <div className="flex justify-between gap-4 text-sm py-1 border-b border-border/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-end break-all">{value || '-'}</span>
    </div>
  );
  return (
    <Dialog open={!!payout} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bank details of {payout?.consultant_name}</DialogTitle>
          <DialogDescription>Check them (for example with a call or an e-mail you trust) before the first transfer, then mark them verified.</DialogDescription>
        </DialogHeader>
        {detailsQ.isLoading ? <Skeleton className="h-40 rounded-xl" /> : !d ? (
          <p className="text-sm text-muted-foreground py-4">The consultant has not entered bank details yet. A payout can not be started before.</p>
        ) : (
          <div>
            {row('Account holder', d.account_holder)}
            {row('Bank', d.bank_name)}
            {row('IBAN', d.iban)}
            {row('Account number', d.account_number)}
            {row('SWIFT / BIC', d.swift_bic)}
            {row('Country', d.country)}
            {row('Currency', d.currency)}
            {row('Notes', d.notes)}
            <div className="pt-3 text-xs text-muted-foreground">
              {d.verified_at ? `Verified on ${when(d.verified_at)}.` : 'Not verified. When the consultant changes any detail the verification is reset.'}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {d && !d.verified_at && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">
                {d.acknowledged_at ? `Disclaimer accepted ${when(d.acknowledged_at)}` : 'Disclaimer not accepted yet'}
              </span>
              <Button disabled={verify.isPending} onClick={() => verify.mutate(d.consultant_id)}>Mark as verified</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateInvoice();
  const people = useBillingPeople(open);
  const [clientId, setClientId] = useState('none');
  const [consultantId, setConsultantId] = useState('none');
  const [ticketId, setTicketId] = useState('none');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [vat, setVat] = useState('0');
  const [description, setDescription] = useState('');
  const [dueDays, setDueDays] = useState('14');
  const ticketsQ = useClientTicketsForInvoice(clientId !== 'none' ? clientId : null);

  useEffect(() => {
    if (open) {
      setClientId('none'); setConsultantId('none'); setTicketId('none'); setAmount('');
      setCurrency('USD'); setVat('0'); setDescription(''); setDueDays('14');
    }
  }, [open]);

  const valid = clientId !== 'none' && Number(amount) > 0 && description.trim().length >= 3 && /^[A-Za-z]{3}$/.test(currency.trim());
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>For work that is not billed automatically (sessions, extra work). Invoices for approved timesheets are created by the platform.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Client *</Label>
            <Select value={clientId} onValueChange={(v) => { setClientId(v); setTicketId('none'); }}>
              <SelectTrigger><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a client...</SelectItem>
                {(people.data?.clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Consultant (gets a payout after the client pays; leave empty for a platform invoice)</Label>
            <Select value={consultantId} onValueChange={setConsultantId}>
              <SelectTrigger><SelectValue placeholder="No consultant" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No consultant</SelectItem>
                {(people.data?.consultants ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ticket (optional)</Label>
            <Select value={ticketId} onValueChange={setTicketId} disabled={clientId === 'none'}>
              <SelectTrigger><SelectValue placeholder="No ticket" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No ticket</SelectItem>
                {(ticketsQ.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (incl. VAT) *</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">VAT part</Label>
              <Input type="number" step="0.01" min="0" value={vat} onChange={(e) => setVat(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency *</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">What is it for? *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Workshop on 12 October, 3 hours" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Payment term (days)</Label>
            <Input type="number" min="1" max="180" value={dueDays} onChange={(e) => setDueDays(e.target.value)} className="w-28" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => create.mutate({
              clientId,
              consultantId: consultantId === 'none' ? null : consultantId,
              ticketId: ticketId === 'none' ? null : ticketId,
              amount: Number(amount),
              currency: currency.trim().toUpperCase(),
              description: description.trim(),
              vat: Number(vat) || 0,
              dueDays: Number(dueDays) || 14,
            }, { onSuccess: onClose })}
          >
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================ settings */

function SettingsTab() {
  const settingsQ = usePaymentSettings();
  const save = useSavePaymentSetting();
  const [commission, setCommission] = useState('');
  const [vat, setVat] = useState('');
  const [bank, setBank] = useState<BankDetails>({});

  useEffect(() => {
    if (settingsQ.data) {
      setCommission(settingsQ.data.commission === null ? '' : String(settingsQ.data.commission));
      setVat(settingsQ.data.vat === null ? '' : String(settingsQ.data.vat));
      setBank(settingsQ.data.bank ?? {});
    }
  }, [settingsQ.data]);

  const field = (key: keyof BankDetails, label: string, placeholder = '') => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={bank[key] ?? ''} onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))} placeholder={placeholder} />
    </div>
  );

  if (settingsQ.isLoading) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2"><CardTitle className="text-base">Commission on old-style invoices</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Only for invoices that you create by hand and for invoices made before the new pricing: the share of the invoice (without VAT) that the platform keeps. Invoices made from an approved timesheet do not use it, the consultant gets the whole fee.
            Old-style payments with a consultant can not be confirmed until it is set.
          </p>
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Commission (%)</Label>
              <Input type="number" step="0.5" min="0" max="60" value={commission} onChange={(e) => setCommission(e.target.value)} className="w-32" />
            </div>
            <Button disabled={commission === '' || save.isPending} onClick={() => save.mutate({ key: 'commission_percent', value: Number(commission) })}>Save</Button>
          </div>
          <div className="flex items-end gap-3 pt-2 border-t border-border/40">
            <div className="space-y-1.5">
              <Label className="text-xs">VAT (%) - the same value as in the card above</Label>
              <Input type="number" step="0.5" min="0" max="30" value={vat} onChange={(e) => setVat(e.target.value)} className="w-32" />
            </div>
            <Button variant="outline" disabled={vat === '' || save.isPending} onClick={() => save.mutate({ key: 'vat_percent', value: Number(vat) })}>Save</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Ask your accountant which VAT applies. It is added on top of the consultant fee plus the platform service fee and the payment processing fee.</p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2"><CardTitle className="text-base">Bank details for client payments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This is the platform account for all invoices. Only administrators and clients who may pay by bank transfer (see "Who may pay by bank transfer") see it, together with the amount and a payment reference. To use another account for one invoice, open it in All invoices and choose "Payment options".
          </p>
          <div className="grid grid-cols-2 gap-3">
            {field('beneficiary', 'Account holder')}
            {field('bank_name', 'Bank')}
            {field('iban', 'IBAN')}
            {field('account_number', 'Account number')}
            {field('swift', 'SWIFT / BIC')}
            {field('currency', 'Currency', 'USD')}
            {field('country', 'Country')}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Instructions for the client (optional)</Label>
            <Textarea value={bank.instructions ?? ''} onChange={(e) => setBank((b) => ({ ...b, instructions: e.target.value }))} rows={2} maxLength={1000} placeholder="Write the payment reference in the transfer description." />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={save.isPending}
              onClick={() => {
                const clean: Record<string, string> = {};
                (Object.keys(bank) as (keyof BankDetails)[]).forEach((k) => {
                  const v = String(bank[k] ?? '').trim();
                  if (v) clean[k] = k === 'currency' ? v.toUpperCase() : v;
                });
                save.mutate({ key: 'platform_bank_details', value: clean });
              }}
            >
              Save bank details
            </Button>
          </div>
          <BankAccountHistory />
        </CardContent>
      </Card>

      <CardPaymentsCard
        commissionSet={settingsQ.data?.commission !== null && settingsQ.data?.commission !== undefined}
        cardsOn={!!settingsQ.data?.cards}
      />
    </div>
  );
}

function CardPaymentsCard({ commissionSet, cardsOn }: { commissionSet: boolean; cardsOn: boolean }) {
  const statusQ = usePaymobStatus();
  const eventsQ = useProviderEvents();
  const save = useSavePaymentSetting();
  const invoicesQ = useAdminInvoices();
  const companiesQ = useBankTransferCompanies();
  const grantsQ = useInvoiceBankGrants();
  const [confirmOn, setConfirmOn] = useState(false);
  const openInvoices = (invoicesQ.data ?? []).filter((i) => i.status === 'pending');
  const allowedCompanies = new Set((companiesQ.data ?? []).filter((c) => c.allowed).map((c) => c.id));
  const cardOnlyCount = openInvoices.filter((i) => !grantsQ.data?.[i.id] && !(i.tenant_id && allowedCompanies.has(i.tenant_id))).length;
  const reportedCount = openInvoices.filter((i) => i.client_reported_at).length;
  const status = statusQ.data;
  const keysReady =
    !!status &&
    status.configured.secret_key &&
    status.configured.public_key &&
    status.configured.hmac_secret &&
    status.configured.card_integration_id &&
    status.modes_match;
  const canSwitchOn = keysReady && commissionSet;
  const checks: Array<[string, boolean | undefined]> = [
    ['Secret key', status?.configured.secret_key],
    ['Public key', status?.configured.public_key],
    ['HMAC secret', status?.configured.hmac_secret],
    ['Card integration ID', status?.configured.card_integration_id],
  ];
  const events: ProviderEvent[] = eventsQ.data ?? [];

  return (
    <Card className="rounded-2xl border-border/50 md:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" /> Card payments (Paymob)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Clients pay an open invoice by card on Paymob's secure page: this is the main way to pay. The invoice is then marked as paid and the consultant payout is created
          automatically, exactly as when you confirm a bank transfer. Paying the consultant stays manual (Payouts tab) and is due within 15 business days.
          Bank transfer becomes optional: it stays open only for the companies and invoices that you allow (see "Who may pay by bank transfer" above).
          Paymob pays out to your bank account in EGP.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Set-up</p>
            {statusQ.isLoading ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : statusQ.isError || !status ? (
              <p className="text-xs text-destructive">The card payment service did not answer. It goes live when the latest version of the project is published.</p>
            ) : (
              <>
                <ul className="text-sm space-y-1">
                  {checks.map(([label, ok]) => (
                    <li key={label} className="flex items-center gap-2">
                      {ok ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-destructive" />}
                      <span>{label}</span>
                      <span className="text-xs text-muted-foreground">{ok ? 'set' : 'missing'}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge variant={status.mode === 'live' ? 'default' : 'secondary'} className="text-[10px]">
                    {status.mode === 'live' ? 'Live mode: real money' : status.mode === 'test' ? 'Test mode: no real money' : 'Mode unknown'}
                  </Badge>
                  {!status.modes_match && <Badge variant="destructive" className="text-[10px]">Secret and public key are from different modes</Badge>}
                </div>
                <p className="text-[11px] text-muted-foreground break-all">
                  Paymob reports every payment to <span className="font-mono">{status.webhook_url}</span>. This address is sent with each payment, so nothing has to be set for it in the Paymob dashboard.
                </p>
                <p className="text-[11px] text-muted-foreground">The keys are stored as secrets of the project (Lovable: Cloud, Secrets). They are never shown here.</p>
              </>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Offer card payments to clients</p>
            <div className="flex items-center gap-3">
              <Switch
                checked={cardsOn}
                disabled={save.isPending || (!cardsOn && !canSwitchOn)}
                onCheckedChange={(on) => (on ? setConfirmOn(true) : save.mutate({ key: 'card_payments_enabled', value: false }))}
                aria-label="Offer card payments to clients"
              />
              <span className="text-sm">{cardsOn ? 'On: clients pay by card; bank transfer only where you allow it' : 'Off: card payment is hidden and bank transfer is open for everybody'}</span>
            </div>
            {!cardsOn && !canSwitchOn && (
              <p className="text-xs text-muted-foreground">
                {!keysReady ? 'Add the four Paymob secrets first (all from the same mode).' : 'Set the platform commission first (the card above).'}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Last messages from Paymob</p>
          {eventsQ.isLoading ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No card payment yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead className="text-end">Amount</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Via</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{when(e.created_at)}</TableCell>
                      <TableCell className="text-xs capitalize">{e.kind}</TableCell>
                      <TableCell className="text-end text-sm">{money(e.amount, e.currency ?? 'USD')}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={e.outcome === 'applied' || e.outcome === 'recorded' ? 'default' : 'destructive'} className="text-[10px]">{e.outcome ?? '-'}</Badge>
                        {e.detail && <div className="text-muted-foreground mt-0.5 max-w-[240px]">{e.detail}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.delivered_via}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <Dialog open={confirmOn} onOpenChange={setConfirmOn}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Switch card payments on?</DialogTitle>
              <DialogDescription>
                Clients will pay by card. Bank transfer closes for every company and invoice that you have not allowed.
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              <li>{`${cardOnlyCount} of ${openInvoices.length} open invoices will be payable by card only.`}</li>
              {reportedCount > 0 && (
                <li>{`${reportedCount} ${reportedCount === 1 ? 'client has' : 'clients have'} already reported a bank transfer; you can still confirm ${reportedCount === 1 ? 'it' : 'those'}.`}</li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground">You can allow bank transfer again for a company or an invoice at any time.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOn(false)}>Cancel</Button>
              <Button
                disabled={save.isPending}
                onClick={() => save.mutate({ key: 'card_payments_enabled', value: true }, { onSuccess: () => setConfirmOn(false) })}
              >
                Switch on
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** The last changes of the bank account (the platform account for all invoices, or the own account of one invoice). The number is never shown in full. */
function BankAccountHistory() {
  const logQ = useBankAccountLog(5);
  const rows = logQ.data ?? [];
  if (logQ.isLoading || rows.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-border/40 pt-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Recent changes of the bank account</p>
      <ul className="space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Badge variant="outline" className="text-[10px]">{r.scope === 'all' ? 'All invoices' : 'One invoice'}</Badge>
            {r.scope === 'invoice' && <span className="font-mono">{r.label.replace(/^Invoice\s*/, '')}</span>}
            <span>{r.summary || '-'}</span>
            <span className="text-muted-foreground">{when(r.changed_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

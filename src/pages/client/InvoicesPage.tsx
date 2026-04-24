import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClientPayments } from '@/hooks/useClientPayments';
import { useClientTickets } from '@/hooks/useClientTickets';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  FileText, Download, Search, Calendar, User, DollarSign, Ticket,
  ArrowRight, CheckCircle2, Clock, XCircle, AlertCircle, ReceiptText,
  CreditCard, Eye, Printer, Plus, Pencil, ArrowUpDown, RefreshCw,
} from 'lucide-react';
import { generateInvoicePdf as buildInvoicePdf } from '@/lib/invoicePdf';
import { Video, MessageSquare, Monitor, PlayCircle } from 'lucide-react';
import { PaymentStatusTimeline } from '@/components/invoice/PaymentStatusTimeline';
import { InvoiceDisputeSection } from '@/components/invoice/InvoiceDisputeSection';
import { ConvertedAmount } from '@/components/currency/ConvertedAmount';
import { CurrencySelector } from '@/components/currency/CurrencySelector';

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  completed: { label: 'Paid', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  paid: { label: 'Paid', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  pending: { label: 'Unpaid', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  unpaid: { label: 'Unpaid', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  processing: { label: 'Processing', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  refunded: { label: 'Refunded', color: 'bg-muted text-muted-foreground', icon: AlertCircle },
};

const matchesTab = (status: string, tab: string) => {
  if (tab === 'all') return true;
  if (tab === 'paid') return status === 'completed' || status === 'paid';
  if (tab === 'unpaid') return status === 'pending' || status === 'unpaid';
  if (tab === 'processing') return status === 'processing';
  if (tab === 'failed') return status === 'failed';
  return true;
};

const fmt = (amount: number, currency: string = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export default function InvoicesPage() {
  const { t } = useTranslation();
  const { data: payments, isLoading } = useClientPayments();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount_desc' | 'amount_asc'>('newest');
  const [selected, setSelected] = useState<any>(null);
  const [pdfPreview, setPdfPreview] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ticket_id: '', amount: '', currency: 'USD', vat: '', description: '', due_date: '' });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ amount: '', currency: '', vat: '', description: '', due_date: '', status: '' });
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data: tickets } = useClientTickets();
  const queryClient = useQueryClient();

  const selectedTicket = (tickets || []).find((t: any) => t.id === createForm.ticket_id);

  const handleTicketSelect = (ticketId: string) => {
    const ticket = (tickets || []).find((t: any) => t.id === ticketId);
    if (ticket) {
      setCreateForm(prev => ({
        ...prev,
        ticket_id: ticketId,
        description: `Invoice for ticket: ${ticket.title} (${ticket.sap_module})${ticket.description ? ' — ' + ticket.description.slice(0, 120) : ''}`,
        amount: (ticket as any).planned_cost ? String((ticket as any).planned_cost) : prev.amount,
        currency: (ticket as any).cost_currency || prev.currency,
      }));
    }
  };

  const handleCreateInvoice = async () => {
    if (!createForm.amount || Number(createForm.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const invoiceNum = `INV-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await (supabase.from('payments') as any).insert({
        client_id: user.id,
        ticket_id: createForm.ticket_id || null,
        amount: Number(createForm.amount),
        currency: createForm.currency,
        vat_amount: Number(createForm.vat || 0),
        description: createForm.description || null,
        due_date: createForm.due_date || null,
        invoice_number: invoiceNum,
        status: 'pending',
        consultant_id: selectedTicket?.consultant_id || null,
      });
      if (error) throw error;
      toast.success(`Invoice ${invoiceNum} created`);
      setCreateOpen(false);
      setCreateForm({ ticket_id: '', amount: '', currency: 'USD', vat: '', description: '', due_date: '' });
      queryClient.invalidateQueries({ queryKey: ['client-payments'] });
    } catch (e: any) {
      toast.error(e.message || 'Failed to create invoice');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (inv: any) => {
    setSelected(inv);
    setEditing(false);
    setEditForm({
      amount: String(inv.amount || ''),
      currency: inv.currency || 'USD',
      vat: String(inv.vat || ''),
      description: inv.description || '',
      due_date: inv.due_date ? inv.due_date.split('T')[0] : '',
      status: inv.status || 'pending',
    });
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { error } = await (supabase.from('payments') as any).update({
        amount: Number(editForm.amount),
        currency: editForm.currency,
        vat_amount: Number(editForm.vat || 0),
        description: editForm.description || null,
        due_date: editForm.due_date || null,
        status: editForm.status,
      }).eq('id', selected.id);
      if (error) throw error;
      toast.success('Invoice updated');
      setEditing(false);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ['client-payments'] });
    } catch (e: any) {
      toast.error(e.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const all = payments || [];
  const getDate = (p: any) => new Date(p.created_at || p.date || 0).getTime();
  const filtered = all
    .filter((p: any) => {
      const s = search.toLowerCase();
      const matchSearch = !s ||
        p.invoice?.toLowerCase().includes(s) ||
        p.consultant?.toLowerCase().includes(s) ||
        p.ticket_title?.toLowerCase().includes(s) ||
        p.description?.toLowerCase().includes(s);
      const matchTab = matchesTab(p.status, tab);
      return matchSearch && matchTab;
    })
    .sort((a: any, b: any) => {
      switch (sortBy) {
        case 'oldest': return getDate(a) - getDate(b);
        case 'amount_desc': return Number(b.amount || 0) - Number(a.amount || 0);
        case 'amount_asc': return Number(a.amount || 0) - Number(b.amount || 0);
        case 'newest':
        default: return getDate(b) - getDate(a);
      }
    });

  const counts = {
    all: all.length,
    paid: all.filter((p: any) => p.status === 'completed' || p.status === 'paid').length,
    unpaid: all.filter((p: any) => p.status === 'pending' || p.status === 'unpaid').length,
    processing: all.filter((p: any) => p.status === 'processing').length,
    failed: all.filter((p: any) => p.status === 'failed').length,
  };

  const [failedDownloads, setFailedDownloads] = useState<Record<string, boolean>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const generateInvoicePdf = async (inv: any, preview = false) => {
    setRetryingId(inv.id);
    try {
      if (preview) {
        const url = buildInvoicePdf(inv, { preview: true });
        if (typeof url !== 'string') throw new Error('Preview URL not produced');
        setPdfPreview(url);
      } else {
        buildInvoicePdf(inv);
      }
      setFailedDownloads(prev => {
        if (!prev[inv.id]) return prev;
        const { [inv.id]: _, ...rest } = prev;
        return rest;
      });
    } catch (err: any) {
      setFailedDownloads(prev => ({ ...prev, [inv.id]: true }));
      toast.error('Could not generate invoice PDF', {
        description: err?.message || 'Something went wrong. Please retry.',
        action: { label: 'Retry', onClick: () => generateInvoicePdf(inv, preview) },
      });
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <ReceiptText className="w-6 h-6 text-primary" /> {t('sidebar.invoices', 'Invoices')}
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">View invoice details, link to tickets, and export as PDF.</p>
        </div>
        <Button className="gap-1.5 gradient-primary border-0" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Create Invoice
        </Button>
      </div>

      {/* Search + Filter + Sort */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search invoices, tickets, consultants..." value={search} onChange={e => setSearch(e.target.value)} className="ps-9 rounded-xl" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-9 flex-wrap">
              <TabsTrigger value="all" className="text-xs">All ({counts.all})</TabsTrigger>
              <TabsTrigger value="paid" className="text-xs">Paid ({counts.paid})</TabsTrigger>
              <TabsTrigger value="unpaid" className="text-xs">Unpaid ({counts.unpaid})</TabsTrigger>
              <TabsTrigger value="processing" className="text-xs">Processing ({counts.processing})</TabsTrigger>
              <TabsTrigger value="failed" className="text-xs">Failed ({counts.failed})</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-9 w-[180px] rounded-xl text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 me-1.5 text-muted-foreground" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="amount_desc">Highest amount</SelectItem>
              <SelectItem value="amount_asc">Lowest amount</SelectItem>
            </SelectContent>
          </Select>
          <CurrencySelector />
        </div>
      </div>

      {/* Invoice List */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No invoices found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((inv: any) => {
            const sc = statusConfig[inv.status] || statusConfig.pending;
            const StatusIcon = sc.icon;
            return (
              <Card key={inv.id} className="rounded-2xl border-border/50 hover:border-primary/30 hover:shadow-premium transition-all cursor-pointer" onClick={() => openEdit(inv)}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <ReceiptText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{inv.invoice}</p>
                          <Badge variant="secondary" className={`text-[10px] gap-1 ${sc.color}`}>
                            <StatusIcon className="w-3 h-3" /> {sc.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="inline-flex items-center gap-1"><User className="w-3 h-3" /> {inv.consultant}</span>
                          <span className="mx-2">·</span>
                          <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {inv.date}</span>
                        </p>
                        {inv.ticket_title && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <Ticket className="w-3 h-3 text-primary" />
                            <span className="text-xs text-primary font-medium truncate">{inv.ticket_title}</span>
                            {inv.ticket_sap_module && <Badge variant="outline" className="text-[9px]">{inv.ticket_sap_module}</Badge>}
                          </div>
                        )}
                        {inv.session_id && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <SessionTypeIcon type={inv.session_type} className="w-3 h-3 text-blue-600" />
                            <span className="text-xs text-blue-600 font-medium capitalize">
                              {(inv.session_type || 'session').toString().replace(/_/g, ' ')} session
                            </span>
                            {inv.session_status && (
                              <Badge variant="outline" className="text-[9px] capitalize">{inv.session_status}</Badge>
                            )}
                            {inv.session_scheduled_at && (
                              <span className="text-[10px] text-muted-foreground">
                                · {format(new Date(inv.session_scheduled_at), 'MMM d, h:mm a')}
                              </span>
                            )}
                          </div>
                        )}
                        {inv.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{inv.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-end">
                        <ConvertedAmount amount={Number(inv.amount)} currency={inv.currency} className="items-end text-sm font-bold text-foreground" />
                        {Number(inv.vat) > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">VAT: {fmt(Number(inv.vat), inv.currency)}</p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title="Preview PDF" onClick={e => { e.stopPropagation(); generateInvoicePdf(inv, true); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Download PDF" onClick={e => { e.stopPropagation(); generateInvoicePdf(inv, false); }}>
                          <Download className="w-4 h-4" />
                        </Button>
                        {failedDownloads[inv.id] && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
                            title="Retry generating the PDF"
                            onClick={e => { e.stopPropagation(); generateInvoicePdf(inv, false); }}
                            disabled={retryingId === inv.id}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${retryingId === inv.id ? 'animate-spin' : ''}`} />
                            Retry
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Invoice Detail / Edit Dialog */}
      <Dialog open={!!selected} onOpenChange={() => { setSelected(null); setEditing(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-primary" /> {selected?.invoice}
            </DialogTitle>
          </DialogHeader>
          {selected && !editing && (() => {
            const sc = statusConfig[selected.status] || statusConfig.pending;
            const Icon = sc.icon;
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className={`gap-1 ${sc.color}`}><Icon className="w-3.5 h-3.5" /> {sc.label}</Badge>
                  <ConvertedAmount amount={Number(selected.amount)} currency={selected.currency} className="ml-auto items-end text-lg font-bold text-foreground" />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DetailRow label="Consultant" value={selected.consultant} icon={User} />
                  <DetailRow label="Date" value={selected.date} icon={Calendar} />
                  <DetailRow label="Currency" value={selected.currency} icon={DollarSign} />
                  <DetailRow label="VAT" value={fmt(Number(selected.vat || 0), selected.currency)} icon={FileText} />
                  {selected.payment_method && <DetailRow label="Method" value={selected.payment_method} icon={CreditCard} />}
                  {selected.due_date && <DetailRow label="Due Date" value={format(new Date(selected.due_date), 'MMM d, yyyy')} icon={Calendar} />}
                </div>

                {selected.description && (
                  <div className="rounded-lg bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</p>
                    <p className="text-sm text-foreground">{selected.description}</p>
                  </div>
                )}

                {selected.ticket_id && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                    <p className="text-xs font-semibold text-primary uppercase mb-1 flex items-center gap-1">
                      <Ticket className="w-3 h-3" /> Linked Ticket
                    </p>
                    <p className="text-sm font-medium text-foreground">{selected.ticket_title}</p>
                    <div className="flex gap-1.5 mt-1">
                      {selected.ticket_sap_module && <Badge variant="secondary" className="text-[10px]">{selected.ticket_sap_module}</Badge>}
                      {selected.ticket_urgency && <Badge variant="outline" className="text-[10px]">{selected.ticket_urgency}</Badge>}
                    </div>
                    <Link to={`/client/tickets/${selected.ticket_id}`} className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                      View Ticket <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                )}

                <PaymentStatusTimeline payment={selected} />

                <InvoiceDisputeSection payment={selected} />

                <div className="flex gap-2 pt-2">
                  <Button className="flex-1 gap-1.5" variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="w-4 h-4" /> Edit
                  </Button>
                  <Button className="flex-1 gap-1.5" variant="outline" size="sm" onClick={() => generateInvoicePdf(selected, true)}>
                    <Eye className="w-4 h-4" /> Preview PDF
                  </Button>
                  <Button className="flex-1 gap-1.5 gradient-primary border-0" size="sm" onClick={() => generateInvoicePdf(selected, false)}>
                    <Download className="w-4 h-4" /> Download
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Edit Mode */}
          {selected && editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Amount</Label>
                  <Input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Currency</Label>
                  <Select value={editForm.currency} onValueChange={v => setEditForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="SAR">SAR</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">VAT</Label>
                  <Input type="number" value={editForm.vat} onChange={e => setEditForm(f => ({ ...f, vat: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Status</Label>
                  <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="completed">Paid</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Due Date</Label>
                <Input type="date" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Description</Label>
                <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="rounded-xl min-h-[80px]" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
                <Button className="flex-1 gap-1.5 gradient-primary border-0" size="sm" onClick={handleSaveEdit} disabled={saving}>
                  {saving ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PDF Preview Dialog */}
      <Dialog open={!!pdfPreview} onOpenChange={() => setPdfPreview(null)}>
        <DialogContent className="max-w-3xl h-[85vh] p-0 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="w-4 h-4 text-primary" /> Invoice Preview
            </DialogTitle>
            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => { if (pdfPreview) window.open(pdfPreview, '_blank'); }}>
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
          </div>
          {pdfPreview && (
            <iframe src={pdfPreview} className="w-full flex-1 h-full" title="Invoice PDF Preview" />
          )}
        </DialogContent>
      </Dialog>

      {/* Create Invoice Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Create Invoice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Ticket Selection */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Link to Ticket</Label>
              <Select value={createForm.ticket_id} onValueChange={handleTicketSelect}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select a ticket to auto-fill details..." />
                </SelectTrigger>
                <SelectContent>
                  {(tickets || []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <span className="truncate">{t.title}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{t.sap_module}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Auto-filled ticket info */}
            {selectedTicket && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm space-y-1">
                <p className="text-xs font-semibold text-primary uppercase">Ticket Details</p>
                <p className="font-medium text-foreground">{selectedTicket.title}</p>
                <div className="flex gap-1.5 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">{selectedTicket.sap_module}</Badge>
                  <Badge variant="outline" className="text-[10px]">{selectedTicket.urgency}</Badge>
                  <Badge variant="outline" className="text-[10px]">{selectedTicket.status}</Badge>
                  {selectedTicket.consultant && <Badge className="text-[10px] bg-accent/10 text-accent border-0">{selectedTicket.consultant}</Badge>}
                </div>
              </div>
            )}

            {/* Amount & Currency */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Amount *</Label>
                <Input type="number" placeholder="0.00" value={createForm.amount} onChange={e => setCreateForm(f => ({ ...f, amount: e.target.value }))} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Currency</Label>
                <Select value={createForm.currency} onValueChange={v => setCreateForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="SAR">SAR</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* VAT & Due Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">VAT Amount</Label>
                <Input type="number" placeholder="0.00" value={createForm.vat} onChange={e => setCreateForm(f => ({ ...f, vat: e.target.value }))} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Due Date</Label>
                <Input type="date" value={createForm.due_date} onChange={e => setCreateForm(f => ({ ...f, due_date: e.target.value }))} className="rounded-xl" />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea placeholder="Invoice description (auto-filled from ticket)..." value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} className="rounded-xl min-h-[80px]" />
            </div>

            {/* Total preview */}
            {createForm.amount && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-lg font-bold text-foreground">
                  {fmt(Number(createForm.amount) + Number(createForm.vat || 0), createForm.currency)}
                </span>
              </div>
            )}

            <Button className="w-full gap-1.5 gradient-primary border-0" onClick={handleCreateInvoice} disabled={creating}>
              {creating ? <Clock className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? 'Creating...' : 'Create Invoice'}
            </Button>
          </div>
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
  const Icon = type === "chat" ? MessageSquare : type === "screen_share" ? Monitor : type === "video" ? Video : PlayCircle;
  return <Icon className={className} />;
}

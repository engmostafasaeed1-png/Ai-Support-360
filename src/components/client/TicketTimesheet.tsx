import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Plus, Trash2, Clock, DollarSign, Download, Mail, FileSignature,
  Loader2, User, Calendar, CheckCircle2, Send, FileText, BarChart3,
} from 'lucide-react';
import jsPDF from 'jspdf';

const CATEGORIES = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'development', label: 'Development' },
  { value: 'testing', label: 'Testing' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'support', label: 'Support' },
  { value: 'other', label: 'Other' },
];

const categoryColors: Record<string, string> = {
  analysis: 'bg-violet-100 text-violet-700',
  development: 'bg-blue-100 text-blue-700',
  testing: 'bg-cyan-100 text-cyan-700',
  meeting: 'bg-amber-100 text-amber-700',
  documentation: 'bg-emerald-100 text-emerald-700',
  support: 'bg-pink-100 text-pink-700',
  other: 'bg-muted text-muted-foreground',
};

interface WorkLog {
  id: string;
  ticket_id: string;
  consultant_id: string;
  work_date: string;
  hours: number;
  description: string | null;
  category: string;
  billable: boolean;
  hourly_rate: number;
  total_cost: number;
  created_at: string;
  consultant_name?: string;
}

interface Props {
  ticketId: string;
  ticketTitle: string;
  isReadOnly?: boolean;
  canApprove?: boolean;
}

export default function TicketTimesheet({ ticketId, ticketTitle, isReadOnly = false, canApprove = false }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [respondFor, setRespondFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [responding, setResponding] = useState(false);

  // Fetch work logs
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['ticket-work-logs', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_work_logs')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('work_date', { ascending: false });
      if (error) throw error;

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map((d: any) => d.consultant_id))];
      const nameMap: Record<string, string> = {};
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds);
        const userIds = (consultants || []).map((c: any) => c.user_id);
        const { data: profiles } = await supabase
          .from('profile_directory')
          .select('user_id, display_name')
          .in('user_id', userIds);
        const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.display_name || 'Unknown']));
        for (const c of consultants || []) {
          nameMap[c.id] = profileMap[c.user_id] || 'Unknown';
        }
      }

      return (data || []).map((d: any) => ({
        ...d,
        consultant_name: nameMap[d.consultant_id] || 'Unknown',
      })) as WorkLog[];
    },
  });

  // Fetch submissions
  const { data: submissions = [] } = useQuery({
    queryKey: ['ticket-timesheet-submissions', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_timesheet_submissions')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const totalHours = logs.reduce((sum, l) => sum + (l.hours || 0), 0);
  const billableHours = logs.filter(l => l.billable).reduce((sum, l) => sum + (l.hours || 0), 0);
  const totalCost = logs.reduce((sum, l) => sum + (l.total_cost || 0), 0);

  // Group by consultant
  const byConsultant = logs.reduce((acc, l) => {
    const name = l.consultant_name || 'Unknown';
    if (!acc[name]) acc[name] = { hours: 0, cost: 0, entries: 0 };
    acc[name].hours += l.hours || 0;
    acc[name].cost += l.total_cost || 0;
    acc[name].entries += 1;
    return acc;
  }, {} as Record<string, { hours: number; cost: number; entries: number }>);

  // Group by category
  const byCategory = logs.reduce((acc, l) => {
    if (!acc[l.category]) acc[l.category] = { hours: 0, cost: 0 };
    acc[l.category].hours += l.hours || 0;
    acc[l.category].cost += l.total_cost || 0;
    return acc;
  }, {} as Record<string, { hours: number; cost: number }>);

  const handleDelete = async (logId: string) => {
    const { error } = await supabase.from('ticket_work_logs').delete().eq('id', logId);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Entry removed');
    queryClient.invalidateQueries({ queryKey: ['ticket-work-logs', ticketId] });
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Timesheet Report', 14, 22);
    doc.setFontSize(10);
    doc.text(`Ticket: ${ticketTitle}`, 14, 32);
    doc.text(`Generated: ${format(new Date(), 'MMM d, yyyy HH:mm')}`, 14, 38);
    doc.text(`Total Hours: ${totalHours.toFixed(1)}h | Billable: ${billableHours.toFixed(1)}h | Cost: ${totalCost.toFixed(2)}`, 14, 44);

    let y = 56;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    ['Date', 'Consultant', 'Category', 'Hours', 'Rate', 'Cost', 'Description'].forEach((h, i) => {
      doc.text(h, 14 + i * 27, y);
    });
    y += 6;
    doc.setFont('helvetica', 'normal');

    for (const log of logs) {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(format(new Date(log.work_date), 'MMM d'), 14, y);
      doc.text((log.consultant_name || '').substring(0, 12), 41, y);
      doc.text(log.category, 68, y);
      doc.text(String(log.hours), 95, y);
      doc.text(String(log.hourly_rate || 0), 122, y);
      doc.text(String(log.total_cost || 0), 149, y);
      doc.text((log.description || '').substring(0, 20), 176, y);
      y += 5;
    }

    // Consultant summary
    y += 10;
    doc.setFontSize(12);
    doc.text('Consultant Summary', 14, y);
    y += 8;
    doc.setFontSize(8);
    Object.entries(byConsultant).forEach(([name, data]) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(`${name}: ${data.hours.toFixed(1)}h, ${data.entries} entries, ${data.cost.toFixed(2)} total`, 14, y);
      y += 5;
    });

    doc.save(`timesheet-${ticketId.substring(0, 8)}.pdf`);
    toast.success('PDF downloaded');
  };

  const exportCSV = () => {
    const headers = ['Date', 'Consultant', 'Category', 'Hours', 'Billable', 'Rate', 'Cost', 'Description'];
    const rows = logs.map(l => [
      l.work_date, l.consultant_name, l.category, l.hours,
      l.billable ? 'Yes' : 'No', l.hourly_rate, l.total_cost, `"${(l.description || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${ticketId.substring(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const handleSendForSignature = async (method: string, email?: string) => {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('ticket_timesheet_submissions').insert({
        ticket_id: ticketId,
        submitted_by: user.id,
        status: method === 'email' ? 'submitted' : 'draft',
        total_hours: totalHours,
        total_cost: totalCost,
        signature_method: method,
        sent_to_email: email || null,
        notes: `Timesheet for "${ticketTitle}" — ${logs.length} entries, ${totalHours.toFixed(1)}h total`,
      } as any);
      if (error) throw error;

      toast.success(
        method === 'email'
          ? `Timesheet recorded as submitted for ${email}. E-mail delivery is not connected yet, so please share the PDF with them yourself.`
          : method === 'docusign'
          ? 'Timesheet prepared for DocuSign (integration pending)'
          : method === 'adobe_sign'
          ? 'Timesheet prepared for Adobe Sign (integration pending)'
          : 'Timesheet submitted for manual signature'
      );
      setSendOpen(false);
      queryClient.invalidateQueries({ queryKey: ['ticket-timesheet-submissions', ticketId] });
    } catch {
      toast.error('Failed to submit timesheet');
    } finally {
      setSending(false);
    }
  };

  const respond = async (id: string, approve: boolean, noteText?: string) => {
    setResponding(true);
    const { error } = await supabase.rpc('respond_to_timesheet', {
      _submission_id: id,
      _approve: approve,
      _note: noteText?.trim() || undefined,
    });
    setResponding(false);
    if (error) {
      toast.error(approve ? 'Could not approve the timesheet' : 'Could not send the timesheet back', { description: error.message });
      return;
    }
    toast.success(approve ? 'Timesheet approved' : 'Timesheet sent back');
    setRespondFor(null);
    setNote('');
    queryClient.invalidateQueries({ queryKey: ['ticket-timesheet-submissions', ticketId] });
  };

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard icon={Clock} label="Total Hours" value={`${totalHours.toFixed(1)}h`} sub={`${billableHours.toFixed(1)}h billable`} />
        <SummaryCard icon={DollarSign} label="Total Cost" value={`${totalCost.toLocaleString()}`} sub={`${logs.length} entries`} />
        <SummaryCard icon={User} label="Consultants" value={String(Object.keys(byConsultant).length)} sub={`${Object.keys(byCategory).length} categories`} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {!isReadOnly && (
          <Button size="sm" className="gap-1.5 gradient-primary border-0 text-xs h-8" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Entry
          </Button>
        )}
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={generatePDF}>
          <Download className="w-3.5 h-3.5" /> Export PDF
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={exportCSV}>
          <FileText className="w-3.5 h-3.5" /> Export CSV
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setSendOpen(true)}>
          <FileSignature className="w-3.5 h-3.5" /> Send for Signature
        </Button>
      </div>

      {/* Tabs: Entries / By Consultant / By Category / Submissions */}
      <Tabs defaultValue="entries" className="w-full">
        <TabsList className="w-full grid grid-cols-4 h-9">
          <TabsTrigger value="entries" className="text-xs">Entries</TabsTrigger>
          <TabsTrigger value="consultants" className="text-xs">By Consultant</TabsTrigger>
          <TabsTrigger value="categories" className="text-xs">By Category</TabsTrigger>
          <TabsTrigger value="submissions" className="text-xs">Submissions</TabsTrigger>
        </TabsList>

        {/* Entries Tab */}
        <TabsContent value="entries" className="mt-3">
          {logs.length === 0 ? (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="py-8 text-center">
                <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No work logged yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <Card key={log.id} className="rounded-xl border-border/30 hover:shadow-sm transition-shadow">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary">
                        {log.hours}h
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{log.consultant_name}</span>
                          <Badge variant="secondary" className={`text-[10px] ${categoryColors[log.category] || ''}`}>
                            {log.category}
                          </Badge>
                          {log.billable && (
                            <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                              Billable
                            </Badge>
                          )}
                          {!isReadOnly && (
                            <button onClick={() => handleDelete(log.id)} className="ms-auto text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(log.work_date), 'MMM d, yyyy')}
                          {log.hourly_rate > 0 && ` · ${log.hourly_rate}/hr · ${(log.total_cost || 0).toFixed(2)} total`}
                        </p>
                        {log.description && (
                          <p className="text-xs text-muted-foreground mt-1">{log.description}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* By Consultant Tab */}
        <TabsContent value="consultants" className="mt-3">
          <div className="space-y-2">
            {Object.entries(byConsultant).map(([name, data]) => (
              <Card key={name} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="text-xs text-muted-foreground">{data.entries} entries</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground">{data.hours.toFixed(1)}h</p>
                    <p className="text-[10px] text-muted-foreground">{data.cost.toFixed(2)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
            {Object.keys(byConsultant).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No data</p>
            )}
          </div>
        </TabsContent>

        {/* By Category Tab */}
        <TabsContent value="categories" className="mt-3">
          <div className="space-y-2">
            {Object.entries(byCategory).map(([cat, data]) => {
              const pct = totalHours > 0 ? (data.hours / totalHours * 100) : 0;
              return (
                <Card key={cat} className="rounded-xl border-border/30">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge variant="secondary" className={`text-[10px] capitalize ${categoryColors[cat] || ''}`}>
                        {cat}
                      </Badge>
                      <span className="text-sm font-semibold text-foreground ms-auto">{data.hours.toFixed(1)}h</span>
                      <span className="text-[10px] text-muted-foreground">{pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {Object.keys(byCategory).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No data</p>
            )}
          </div>
        </TabsContent>

        {/* Submissions Tab */}
        <TabsContent value="submissions" className="mt-3">
          <div className="space-y-2">
            {submissions.map((sub: any) => (
              <Card key={sub.id} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    sub.status === 'signed' ? 'bg-green-100' :
                    sub.status === 'submitted' ? 'bg-amber-100' : 'bg-muted/30'
                  }`}>
                    {sub.status === 'signed' ? <CheckCircle2 className="w-4 h-4 text-green-700" /> :
                     sub.status === 'submitted' ? <Send className="w-4 h-4 text-amber-700" /> :
                     <FileText className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] capitalize">{sub.status === 'signed' ? 'approved' : sub.status}</Badge>
                      {sub.signature_method && (
                        <Badge variant="outline" className="text-[10px] capitalize">{sub.signature_method.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(sub.created_at), 'MMM d, yyyy h:mm a')}
                      {sub.sent_to_email && ` · ${sub.sent_to_email}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {sub.total_hours?.toFixed(1)}h · {sub.total_cost?.toFixed(2)} {sub.cost_currency}
                    </p>
                    {sub.status === 'signed' && sub.signed_by_name && (
                      <p className="text-xs text-green-700">
                        Approved by {sub.signed_by_name}{sub.signed_at ? ` on ${format(new Date(sub.signed_at), 'MMM d, yyyy')}` : ''}
                      </p>
                    )}
                    {sub.status === 'draft' && typeof sub.notes === 'string' && sub.notes.includes('Sent back by the client') && (
                      <p className="text-xs text-amber-700">
                        {sub.notes.split('\n').filter((l: string) => l.startsWith('Sent back by the client')).pop()}
                      </p>
                    )}
                  </div>
                  {canApprove && sub.status === 'submitted' && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" className="h-7 text-xs gradient-primary border-0" disabled={responding} onClick={() => respond(sub.id, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={responding} onClick={() => setRespondFor(sub.id)}>
                        Send back
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {submissions.length === 0 && (
              <Card className="rounded-2xl border-border/50">
                <CardContent className="py-8 text-center">
                  <FileSignature className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No submissions yet</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

<Dialog open={!!respondFor} onOpenChange={(o) => { if (!o) { setRespondFor(null); setNote(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send the timesheet back</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">Note for the consultant (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500} placeholder="What should be corrected..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRespondFor(null); setNote(''); }}>Cancel</Button>
            <Button disabled={responding} onClick={() => respondFor && respond(respondFor, false, note)}>Send back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Entry Dialog */}
      <AddWorkLogDialog ticketId={ticketId} open={addOpen} onOpenChange={setAddOpen} />

      {/* Send for Signature Dialog */}
      <SendForSignatureDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        onSend={handleSendForSignature}
        sending={sending}
        totalHours={totalHours}
        totalCost={totalCost}
        entryCount={logs.length}
      />
    </div>
  );
}

/* ─── Summary Card ─── */
function SummaryCard({ icon: Icon, label, value, sub }: { icon: typeof Clock; label: string; value: string; sub: string }) {
  return (
    <Card className="rounded-xl border-border/50">
      <CardContent className="p-3 text-center">
        <Icon className="w-4 h-4 text-primary mx-auto mb-1" />
        <p className="text-lg font-bold text-foreground">{value}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

/* ─── Add Work Log Dialog ─── */
function AddWorkLogDialog({ ticketId, open, onOpenChange }: { ticketId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    work_date: format(new Date(), 'yyyy-MM-dd'),
    hours: '1',
    description: '',
    category: 'support',
    billable: true,
    hourly_rate: '0',
  });

  const handleSave = async () => {
    const hours = parseFloat(form.hours);
    if (!hours || hours <= 0) { toast.error('Hours must be greater than 0'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get consultant id
      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!consultant) {
        toast.error('Only consultants can log work');
        setSaving(false);
        return;
      }

      const { error } = await supabase.from('ticket_work_logs').insert({
        ticket_id: ticketId,
        consultant_id: consultant.id,
        work_date: form.work_date,
        hours,
        description: form.description.trim() || null,
        category: form.category,
        billable: form.billable,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
      } as any);
      if (error) throw error;

      toast.success('Work entry logged');
      queryClient.invalidateQueries({ queryKey: ['ticket-work-logs', ticketId] });
      onOpenChange(false);
      setForm({ work_date: format(new Date(), 'yyyy-MM-dd'), hours: '1', description: '', category: 'support', billable: true, hourly_rate: '0' });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to log work');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Log Work Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hours</Label>
              <Input type="number" step="0.25" min="0.25" max="24" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hourly Rate</Label>
              <Input type="number" min="0" value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="What was done..." />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.billable} onChange={e => setForm(f => ({ ...f, billable: e.target.checked }))} className="rounded" />
            Billable hours
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gradient-primary border-0">
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            Log Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Send for Signature Dialog ─── */
function SendForSignatureDialog({
  open, onOpenChange, onSend, sending, totalHours, totalCost, entryCount,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSend: (method: string, email?: string) => void;
  sending: boolean; totalHours: number; totalCost: number; entryCount: number;
}) {
  const [method, setMethod] = useState('email');
  const [email, setEmail] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSignature className="w-4 h-4 text-primary" /> Send Timesheet for Signature</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Summary */}
          <Card className="rounded-xl border-border/50">
            <CardContent className="p-3 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold text-foreground">{totalHours.toFixed(1)}h</p>
                <p className="text-[10px] text-muted-foreground">Total Hours</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{totalCost.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">Total Cost</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{entryCount}</p>
                <p className="text-[10px] text-muted-foreground">Entries</p>
              </div>
            </CardContent>
          </Card>

          {/* Method */}
          <div className="space-y-1.5">
            <Label className="text-xs">Signature Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">
                  <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" /> Record as e-mailed</div>
                </SelectItem>
                <SelectItem value="docusign">
                  <div className="flex items-center gap-2"><FileSignature className="w-3.5 h-3.5" /> DocuSign</div>
                </SelectItem>
                <SelectItem value="adobe_sign">
                  <div className="flex items-center gap-2"><FileSignature className="w-3.5 h-3.5" /> Adobe Sign</div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> Manual Signature</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {method === 'email' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Recipient Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@company.com" />
            </div>
          )}

          {(method === 'docusign' || method === 'adobe_sign') && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
              <p className="font-medium mb-1">Integration Setup Required</p>
              <p>To use {method === 'docusign' ? 'DocuSign' : 'Adobe Sign'}, you'll need to configure the integration in Settings. The timesheet will be saved as a draft and can be sent once the integration is connected.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSend(method, method === 'email' ? email : undefined)}
            disabled={sending || (method === 'email' && !email)}
            className="gradient-primary border-0 gap-1.5"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {method === 'email' ? 'Record' : method === 'manual' ? 'Submit' : 'Prepare'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

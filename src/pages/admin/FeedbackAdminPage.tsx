import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ClipboardCopy, Download, ExternalLink, Image as ImageIcon, Loader2, MessageSquareWarning, Search, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import {
  ADMIN_FEEDBACK_PAGE, logFeedbackExport, replyToFeedback, updateFeedback, useAdminFeedback, useAdminFeedbackCounts,
  useFeedbackAssignees, useFeedbackDetail, type AdminFeedbackFilters, type AdminFeedbackRow,
} from '@/hooks/useFeedback';
import {
  csvCell, FEEDBACK_PRIORITIES, FEEDBACK_SEVERITIES, FEEDBACK_STATUSES, FEEDBACK_TYPES, feedbackTaskMarkdown,
} from '@/lib/feedback';
import {
  FEEDBACK_PRIORITY_LABEL, FEEDBACK_SEVERITY_LABEL, FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_TONE, FEEDBACK_TYPE_LABEL,
} from '@/components/feedback/feedbackLabels';
import { cn } from '@/lib/utils';

const ROLES = ['visitor', 'client', 'consultant', 'admin', 'super_admin'];
const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorText(code?: string): string {
  const c = String(code ?? '');
  if (c.includes('rate_limited')) return 'Too many changes in the last hour. Please wait a little.';
  if (c.includes('invalid_duplicate')) return 'The duplicate must be another existing report.';
  if (c.includes('invalid_assignee')) return 'Reports can only be assigned to administrators.';
  if (c.includes('not allowed')) return 'Only administrators can do this.';
  return 'The change could not be saved. Please try again.';
}

// ------------------------------------------------------------------ settings

function SettingsCard() {
  const { settings, loading, updateSetting } = useAdminSettings();
  const [days, setDays] = useState({ feedback_attachment_retention_days: '', feedback_report_retention_days: '' });
  useEffect(() => {
    void (supabase as any).from('platform_settings').select('key, value')
      .in('key', ['feedback_attachment_retention_days', 'feedback_report_retention_days'])
      .then(({ data }: any) => {
        const m = Object.fromEntries((data ?? []).map((r: any) => [r.key, String(r.value)]));
        setDays({ feedback_attachment_retention_days: m.feedback_attachment_retention_days ?? '180', feedback_report_retention_days: m.feedback_report_retention_days ?? '730' });
      });
  }, []);
  const flag = (k: string) => settings[k] !== false; // a missing setting means on (the default)
  const saveDays = async (key: keyof typeof days, min: number) => {
    const n = Number(days[key]);
    if (!Number.isInteger(n) || n < min || n > 3650) { toast.error(`Enter a whole number between ${min} and 3650.`); return; }
    const { error } = await (supabase as any).from('platform_settings').upsert({ key, value: n }, { onConflict: 'key' });
    if (error) toast.error('Could not save.'); else toast.success('Saved');
  };
  const rows: Array<[string, string, string]> = [
    ['feedback_enabled', 'Feedback button and form', 'Turns the whole feature on or off for everyone.'],
    ['feedback_public_enabled', 'Visitors who are not signed in', 'Lets visitors on public pages send feedback (3 per hour per connection).'],
    ['feedback_digest_enabled', 'Weekly summary', 'A short in-app summary for administrators every Monday.'],
  ];
  return (
    <Card className="rounded-2xl">
      <CardHeader><CardTitle className="text-base">Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {rows.map(([k, label, help]) => (
          <div key={k} className="flex items-start justify-between gap-4">
            <div><Label htmlFor={k}>{label}</Label><p className="text-xs text-muted-foreground">{help}</p></div>
            <Switch id={k} disabled={loading} checked={flag(k)} onCheckedChange={(v) => void updateSetting(k, v)} />
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          {([['feedback_attachment_retention_days', 'Keep screenshots (days)', 1], ['feedback_report_retention_days', 'Keep reports (days)', 30]] as const).map(([k, label, min]) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={k}>{label}</Label>
              <div className="flex gap-2">
                <Input id={k} inputMode="numeric" value={days[k]} onChange={(e) => setDays((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, '') }))} />
                <Button variant="outline" onClick={() => void saveDays(k, min)}>Save</Button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Blocking bugs alert administrators immediately; their e-mail follows the normal administrator e-mail switches.</p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ detail

function Detail({ row, onClose }: { row: AdminFeedbackRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useFeedbackDetail(row?.id ?? null);
  const { data: admins = [] } = useFeedbackAssignees(!!row);
  const [notes, setNotes] = useState('');
  const [dup, setDup] = useState('');
  const [reply, setReply] = useState('');
  const [emailReply, setEmailReply] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNotes(row?.admin_notes ?? ''); setDup(row?.duplicate_of ?? ''); setReply(''); setEmailReply(!!row?.consent_contact); }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-feedback'] });
    void qc.invalidateQueries({ queryKey: ['admin-feedback-counts'] });
    void qc.invalidateQueries({ queryKey: ['admin-feedback-detail', row?.id] });
  };
  const patch = async (p: Record<string, unknown>) => {
    if (!row) return;
    setBusy(true);
    const r = await updateFeedback([row.id], p);
    setBusy(false);
    if (r.ok) { toast.success('Saved'); refresh(); } else toast.error(errorText(r.error));
  };
  const sendReply = async () => {
    if (!row || reply.trim().length < 2) return;
    setBusy(true);
    const r = await replyToFeedback(row.id, reply.trim(), emailReply && row.consent_contact);
    setBusy(false);
    if (!r.ok) { toast.error(errorText(r.error)); return; }
    toast.success(r.emailed === 'sent' ? 'Reply sent (notification and e-mail)' : r.emailed === 'failed' ? 'Reply saved; the e-mail could not be sent' : 'Reply sent as a notification');
    setReply('');
    refresh();
  };
  const copyTask = async () => {
    if (!row) return;
    await navigator.clipboard.writeText(feedbackTaskMarkdown(row));
    toast.success('Task copied as Markdown');
  };
  const ctx = (row?.context ?? {}) as Record<string, any>;

  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {row && (
          <>
            <SheetHeader className="text-start">
              <SheetTitle className="break-words" dir="auto">{row.title}</SheetTitle>
              <SheetDescription>
                {FEEDBACK_TYPE_LABEL[row.type]}{row.severity ? ` · ${FEEDBACK_SEVERITY_LABEL[row.severity]}` : ''} · {row.role} · {fmt(row.created_at)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5 text-sm">
              <p className="whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3" dir="auto">{row.description}</p>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyTask()}><ClipboardCopy aria-hidden="true" className="me-1.5 h-4 w-4" />Copy as task</Button>
                {row.user_id && (
                  <Button size="sm" variant="outline" asChild><Link to={`/admin/users?user=${row.user_id}`}><ExternalLink aria-hidden="true" className="me-1.5 h-4 w-4" />Open user</Link></Button>
                )}
              </div>

              <section aria-label="Technical context">
                <h3 className="mb-1.5 font-medium">Context</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {[['Page', row.route], ['Route', ctx.route], ['Version', ctx.version], ['Language / theme', `${ctx.lang ?? '—'} / ${ctx.theme ?? '—'}`],
                    ['Screen', ctx.viewport], ['Browser', `${ctx.browser ?? '—'} · ${ctx.os ?? '—'}`],
                    ['Item on screen', ctx.entity ? `${ctx.entity.kind} ${ctx.entity.id}` : '—'],
                    ['Contact', row.consent_contact ? (row.contact_email || 'Account e-mail') : 'Not allowed']].map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v || '—'}</dd></div>
                  ))}
                </dl>
                {Array.isArray(ctx.errors) && ctx.errors.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">{ctx.errors.map((e: string, i: number) => <li key={i} className="break-all">{e}</li>)}</ul>
                )}
              </section>

              <section aria-label="Screenshots">
                <h3 className="mb-1.5 font-medium">Screenshots</h3>
                {isLoading ? <Skeleton className="h-24 rounded-xl" /> : (data?.files.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">{data?.removed ? 'Removed after the retention period.' : 'None attached.'}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {data!.files.map((f: any) => f.url ? (
                      <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-border">
                        <img src={f.url} alt="Screenshot attached to the report" className="h-28 w-full object-cover" loading="lazy" />
                      </a>
                    ) : <div key={f.id} className="flex h-28 items-center justify-center rounded-lg border border-border"><ImageIcon aria-hidden="true" className="h-5 w-5 text-muted-foreground" /></div>)}
                  </div>
                )}
              </section>

              <section aria-label="Triage" className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={row.status} onValueChange={(v) => void patch({ status: v })} disabled={busy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FEEDBACK_STATUSES.map((s) => <SelectItem key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={row.priority} onValueChange={(v) => void patch({ priority: v })} disabled={busy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FEEDBACK_PRIORITIES.map((s) => <SelectItem key={s} value={s}>{FEEDBACK_PRIORITY_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Assigned to</Label>
                  <Select value={row.assigned_to ?? 'none'} onValueChange={(v) => void patch({ assigned_to: v === 'none' ? null : v })} disabled={busy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nobody</SelectItem>
                      {admins.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fb-dup">Duplicate of (report id)</Label>
                  <div className="flex gap-2">
                    <Input id="fb-dup" value={dup} onChange={(e) => setDup(e.target.value.trim())} placeholder="Report id" />
                    <Button variant="outline" disabled={busy || (dup !== '' && !UUID.test(dup))} onClick={() => void patch({ duplicate_of: dup || null })}>Set</Button>
                  </div>
                </div>
              </section>

              <section aria-label="Internal notes" className="space-y-1.5">
                <Label htmlFor="fb-notes">Internal notes (never shown to the person)</Label>
                <Textarea id="fb-notes" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button size="sm" variant="outline" disabled={busy || notes === (row.admin_notes ?? '')} onClick={() => void patch({ admin_notes: notes })}>Save notes</Button>
              </section>

              <section aria-label="Reply" className="space-y-1.5">
                <Label htmlFor="fb-reply">Reply to the person</Label>
                <Textarea id="fb-reply" rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)}
                  placeholder={row.user_id ? 'Shown on their My feedback page and sent as a notification.' : 'Visitors only receive replies by e-mail when they allowed contact.'} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={emailReply && row.consent_contact} disabled={!row.consent_contact} onCheckedChange={(v) => setEmailReply(v === true)} />
                    {row.consent_contact ? 'Also send by e-mail' : 'E-mail not allowed by the person'}
                  </label>
                  <Button size="sm" disabled={busy || reply.trim().length < 2 || (!row.user_id && !(emailReply && row.consent_contact))} onClick={() => void sendReply()}>
                    {busy ? <Loader2 aria-hidden="true" className="me-1.5 h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="me-1.5 h-4 w-4" />}Send reply
                  </Button>
                </div>
              </section>

              <section aria-label="History">
                <h3 className="mb-1.5 font-medium">History</h3>
                <ol className="space-y-1.5 text-xs">
                  {(data?.events ?? []).map((e: any) => (
                    <li key={e.id} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground">{fmt(e.created_at)}</span>
                      <span className="break-words">
                        {e.kind === 'submitted' ? 'Submitted' : e.kind === 'reply' ? `Reply${e.emailed_at ? ' (e-mailed)' : ''}: ${e.message}` : e.kind === 'note' ? 'Notes updated'
                          : `${e.kind}: ${e.from_value ?? '—'} → ${e.to_value ?? '—'}`}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ------------------------------------------------------------------ page

export default function FeedbackAdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(sp.get('q') ?? '');
  const filters: AdminFeedbackFilters = {
    status: sp.get('status') ?? 'open', type: sp.get('type') ?? 'all', severity: sp.get('severity') ?? 'all',
    role: sp.get('role') ?? 'all', search: sp.get('q') ?? '', page: Math.max(0, Number(sp.get('page') ?? 0) || 0),
  };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (!v || v === 'all' || (k === 'status' && v === 'open')) next.delete(k); else next.set(k, v);
    if (k !== 'page') next.delete('page');
    setSp(next, { replace: true });
  };
  useEffect(() => {
    const h = setTimeout(() => { if (searchDraft !== filters.search) set('q', searchDraft); }, 300);
    return () => clearTimeout(h);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isFetching } = useAdminFeedback(filters);
  const { data: counts } = useAdminFeedbackCounts();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const openId = sp.get('id');
  const rows = data?.rows ?? [];
  const openRow = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);
  const [linked, setLinked] = useState<AdminFeedbackRow | null>(null);
  useEffect(() => {
    // Deep links (?id=…) from the blocking-bug notification may point to a report outside the current filter.
    if (!openId || openRow || !UUID.test(openId)) { setLinked(null); return; }
    void (supabase as any).from('feedback_reports').select('*').eq('id', openId).maybeSingle().then(({ data: r }: any) => setLinked(r ?? null));
  }, [openId, openRow]);
  const detailRow = openRow ?? linked;
  const openDetail = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('id', id); else n.delete('id'); setSp(n, { replace: true }); };
  useEffect(() => { setSelected(new Set()); }, [sp.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyBulk = async () => {
    if (!bulkStatus || selected.size === 0) return;
    const r = await updateFeedback(Array.from(selected).slice(0, 200), { status: bulkStatus });
    if (!r.ok) { toast.error(errorText(r.error)); return; }
    toast.success(`Updated ${selected.size} report${selected.size === 1 ? '' : 's'}`);
    setSelected(new Set()); setBulkStatus('');
    void qc.invalidateQueries({ queryKey: ['admin-feedback'] });
    void qc.invalidateQueries({ queryKey: ['admin-feedback-counts'] });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      let q = (supabase as any).from('feedback_reports')
        .select('id, created_at, type, severity, title, description, route, role, status, priority, attachments')
        .order('created_at', { ascending: false }).limit(1000);
      if (filters.status === 'open') q = q.in('status', ['new', 'triaged', 'in_progress']); else if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.type !== 'all') q = q.eq('type', filters.type);
      if (filters.severity !== 'all') q = q.eq('severity', filters.severity);
      if (filters.role !== 'all') q = q.eq('role', filters.role);
      const { data: all, error } = await q;
      if (error) throw error;
      if (!(await logFeedbackExport(all.length, { ...filters, page: undefined }))) throw new Error('audit');
      const head = ['Report', 'Created', 'Type', 'Severity', 'Title', 'Description', 'Page', 'Role', 'Status', 'Priority', 'Screenshots'];
      const lines = [head.join(','), ...all.map((r: any) => [r.id, r.created_at, r.type, r.severity ?? '', r.title, r.description, r.route, r.role, r.status, r.priority, r.attachments].map(csvCell).join(','))];
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `feedback-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error('The export could not be created.');
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / ADMIN_FEEDBACK_PAGE));
  const statusChips: Array<[string, string]> = [['open', 'Open'], ...FEEDBACK_STATUSES.map((s) => [s, FEEDBACK_STATUS_LABEL[s]] as [string, string]), ['all', 'All']];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><MessageSquareWarning aria-hidden="true" className="h-6 w-6 text-primary" />{String(t('sidebar.feedback', { defaultValue: 'Feedback' }))}</h1>
          <p className="text-sm text-muted-foreground">Bug reports, ideas, questions and compliments sent from the app. Separate from automatic error reports.</p>
        </div>
        {counts && counts.blocking_open > 0 && (
          <Badge variant="outline" className="border-destructive/50 text-destructive">{counts.blocking_open} blocking open</Badge>
        )}
      </div>

      <Tabs defaultValue="reports">
        <TabsList><TabsTrigger value="reports">Reports</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>
        <TabsContent value="settings" className="mt-4"><SettingsCard /></TabsContent>
        <TabsContent value="reports" className="mt-4 space-y-4">
          {data && !data.installed ? (
            <Card className="rounded-2xl"><CardContent className="p-6 text-sm text-muted-foreground">
              Feedback storage is not set up yet. Apply the prepared feedback database file, then reload this page.
            </CardContent></Card>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
                {statusChips.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => set('status', k)} aria-pressed={filters.status === k}
                    className={cn('rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      filters.status === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}>
                    {label}{counts && k in counts ? ` · ${counts[k]}` : k === 'open' && counts ? ` · ${(counts.new ?? 0) + (counts.triaged ?? 0) + (counts.in_progress ?? 0)}` : k === 'all' && counts ? ` · ${counts.total}` : ''}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="relative min-w-[12rem] flex-1">
                  <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Search title, description or page" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search title, description or page" className="ps-9" />
                </div>
                {([['type', 'Type', FEEDBACK_TYPES, FEEDBACK_TYPE_LABEL], ['severity', 'Severity', FEEDBACK_SEVERITIES, FEEDBACK_SEVERITY_LABEL], ['role', 'Sent by', ROLES, Object.fromEntries(ROLES.map((r) => [r, r.replace('_', ' ')]))]] as const).map(([k, label, opts, labels]) => (
                  <Select key={k} value={(filters as any)[k]} onValueChange={(v) => set(k, v)}>
                    <SelectTrigger className="w-[9.5rem]" aria-label={label}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{`${label}: all`}</SelectItem>
                      {(opts as readonly string[]).map((o) => <SelectItem key={o} value={o}>{(labels as any)[o]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ))}
                <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}>
                  {exporting ? <Loader2 aria-hidden="true" className="me-1.5 h-4 w-4 animate-spin" /> : <Download aria-hidden="true" className="me-1.5 h-4 w-4" />}CSV
                </Button>
              </div>

              {selected.size > 0 && (
                <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                  <span className="text-sm">{selected.size} selected</span>
                  <Select value={bulkStatus} onValueChange={setBulkStatus}>
                    <SelectTrigger className="w-[10rem]" aria-label="New status"><SelectValue placeholder="Set status…" /></SelectTrigger>
                    <SelectContent>{FEEDBACK_STATUSES.map((s) => <SelectItem key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" disabled={!bulkStatus} onClick={() => void applyBulk()}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              )}

              <Card className="overflow-hidden rounded-2xl">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox aria-label="Select all on this page" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                            onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.id)) : new Set())} />
                        </TableHead>
                        <TableHead>Report</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Sent by</TableHead>
                        <TableHead>Page</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-6" /></TableCell></TableRow>
                      )) : rows.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No reports match these filters.</TableCell></TableRow>
                      ) : rows.map((r) => (
                        <TableRow key={r.id} className={cn('cursor-pointer', isFetching && 'opacity-70')} onClick={() => openDetail(r.id)}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox aria-label={`Select ${r.title}`} checked={selected.has(r.id)}
                              onCheckedChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v === true) n.add(r.id); else n.delete(r.id); return n; })} />
                          </TableCell>
                          <TableCell className="max-w-[18rem]">
                            <button type="button" className="text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(e) => { e.stopPropagation(); openDetail(r.id); }}>
                              <span className="line-clamp-1 break-all" dir="auto">{r.title}</span>
                            </button>
                            {r.attachments > 0 && <span className="ms-1 text-xs text-muted-foreground">· {r.attachments} image{r.attachments === 1 ? '' : 's'}</span>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {FEEDBACK_TYPE_LABEL[r.type]}
                            {r.severity && <span className={cn('ms-1', r.severity === 'blocks' && 'font-semibold text-destructive')}>· {FEEDBACK_SEVERITY_LABEL[r.severity]}</span>}
                          </TableCell>
                          <TableCell className="text-xs capitalize">{r.role.replace('_', ' ')}</TableCell>
                          <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground" dir="ltr">{r.route || '/'}</TableCell>
                          <TableCell><Badge variant="outline" className={FEEDBACK_STATUS_TONE[r.status]}>{FEEDBACK_STATUS_LABEL[r.status]}</Badge></TableCell>
                          <TableCell className="text-xs">{FEEDBACK_PRIORITY_LABEL[r.priority]}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(r.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              {pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Button size="sm" variant="outline" disabled={filters.page === 0} onClick={() => set('page', String(filters.page - 1))}>Previous</Button>
                  <span>{filters.page + 1} / {pages}</span>
                  <Button size="sm" variant="outline" disabled={filters.page + 1 >= pages} onClick={() => set('page', String(filters.page + 1))}>Next</Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <Detail row={detailRow} onClose={() => openDetail(null)} />
    </div>
  );
}

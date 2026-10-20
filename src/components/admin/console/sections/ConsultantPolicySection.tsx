import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Download, FileCheck2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { SectionShell } from './shared';
import { usePolicyVersion, POLICY_VERSION_KEY } from '@/hooks/useConsultantPolicy';
import { DEFAULT_POLICY_GRACE_DAYS, MAX_POLICY_GRACE_DAYS } from '@/lib/consultantPolicy';
import { filterPolicyRows, policyOverviewCsv, type PolicyFilter, type PolicyOverviewRow } from '@/lib/consultantPolicyCsv';

const KEY = ['admin-consultant-policy'] as const;
const GRACE_KEY = ['admin-policy-grace'] as const;
const AUDIT_KEY = ['admin-policy-audit'] as const;

const STATE_TONE: Record<string, string> = {
  accepted: 'border-success/30 text-success',
  grace: 'border-warning/40 text-foreground',
  pending: 'border-border text-muted-foreground',
  blocked: 'border-destructive/30 text-destructive',
};

/** Admin > Consultant policy: acknowledgement status per consultant, reminders, grace days, publishing and audit trail. */
const ConsultantPolicySection = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const STATE_LABEL: Record<string, string> = {
    accepted: t('admin.policy.accepted', 'Accepted'), grace: t('admin.policy.grace', 'In grace period'),
    pending: t('admin.policy.pending', 'Pending (not shown yet)'), blocked: t('admin.policy.blocked', 'Restricted'), none: '-',
  };
  const q = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ rows: PolicyOverviewRow[]; ready: boolean }> => {
      const { data, error } = await (supabase as any).rpc('admin_consultant_policy_overview');
      if (error) return { rows: [], ready: false };
      return { rows: (data ?? []) as PolicyOverviewRow[], ready: true };
    },
  });
  const graceQ = useQuery({
    queryKey: GRACE_KEY,
    queryFn: async () => {
      const { data } = await supabase.from('platform_settings').select('value').eq('key', 'policy_grace_days').maybeSingle();
      return typeof data?.value === 'number' ? data.value : null;
    },
  });
  const auditQ = useQuery({
    queryKey: AUDIT_KEY,
    enabled: q.data?.ready === true,
    queryFn: async () => {
      const [logs, acks] = await Promise.all([
        supabase.from('audit_logs').select('id, action, metadata, created_at, user_id').eq('entity_type', 'consultant_policy').order('created_at', { ascending: false }).limit(50),
        (supabase as any).from('consultant_policy_acknowledgements').select('id, consultant_id, version, accepted_at, language, source').order('accepted_at', { ascending: false }).limit(50),
      ]);
      return { logs: logs.data ?? [], acks: (acks.data ?? []) as { id: string; consultant_id: string; version: number; accepted_at: string; language: string; source: string }[] };
    },
  });
  const current = usePolicyVersion();
  const ready = q.data?.ready === true;
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const [filter, setFilter] = useState<PolicyFilter>('all');
  const [search, setSearch] = useState('');
  const shown = useMemo(() => filterPolicyRows(rows, filter, search), [rows, filter, search]);
  const counts = useMemo(() => rows.reduce<Record<string, number>>((m, r) => { m[r.state ?? 'none'] = (m[r.state ?? 'none'] ?? 0) + 1; return m; }, {}), [rows]);
  const names = useMemo(() => new Map(rows.map(r => [r.consultant_id, r.display_name || r.email || r.consultant_id])), [rows]);

  const [days, setDays] = useState(String(DEFAULT_POLICY_GRACE_DAYS));
  useEffect(() => { if (typeof graceQ.data === 'number') setDays(String(graceQ.data)); }, [graceQ.data]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: AUDIT_KEY })]);

  const remind = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc('admin_send_policy_reminder', { _consultant_id: id });
      if (error) throw error;
      return data === true;
    },
    onSuccess: sent => { toast[sent ? 'success' : 'info'](sent ? t('admin.policy.reminderSent', 'Reminder sent: in-app now, e-mail within the hour.') : t('admin.policy.reminderSkipped', 'Not sent: already confirmed or reminded in the last 24 hours.')); void refresh(); },
    onError: (e: any) => toast.error(e?.message || t('admin.policy.reminderFailed', 'Could not send the reminder. Please try again.')),
  });

  const saveGrace = useMutation({
    mutationFn: async () => {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 0 || n > MAX_POLICY_GRACE_DAYS) throw new Error(t('admin.policy.graceInvalid', 'Enter whole days between 0 and 90.'));
      const { error } = await (supabase as any).rpc('admin_set_policy_grace_days', { _days: n });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t('admin.policy.graceSaved', 'Grace period saved.')); void qc.invalidateQueries({ queryKey: GRACE_KEY }); void refresh(); },
    onError: (e: any) => toast.error(e?.message || t('admin.policy.graceFailed', 'Could not save the grace period.')),
  });

  // Publish a new version (prefilled with the current text).
  const [draft, setDraft] = useState<null | { title_en: string; title_ar: string; summary_en: string; summary_ar: string; body_en: string; body_ar: string; effective: string }>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const startDraft = () => {
    const p = current.data?.policy;
    if (!p) return;
    setDraft({ title_en: p.en.title, title_ar: p.ar.title, summary_en: p.en.summary, summary_ar: p.ar.summary, body_en: p.en.body, body_ar: p.ar.body, effective: '' });
  };
  const publish = useMutation({
    mutationFn: async () => {
      if (!draft) return 0;
      const { data, error } = await (supabase as any).rpc('admin_publish_consultant_policy', {
        _title_en: draft.title_en, _title_ar: draft.title_ar, _summary_en: draft.summary_en, _summary_ar: draft.summary_ar,
        _body_en: draft.body_en, _body_ar: draft.body_ar, _effective_at: draft.effective ? new Date(draft.effective).toISOString() : null,
      });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: v => { toast.success(t('admin.policy.published', 'Version {{v}} published. Consultants are asked to confirm it.', { v })); setDraft(null); void refresh(); void qc.invalidateQueries({ queryKey: POLICY_VERSION_KEY }); },
    onError: (e: any) => toast.error(e?.message || t('admin.policy.publishFailed', 'Could not publish the new version.')),
  });

  const exportCsv = () => {
    const blob = new Blob([policyOverviewCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `consultant-policy-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const field = (key: keyof NonNullable<typeof draft>, label: string, rows = 3, rtl = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={`policy-${key}`}>{label}</Label>
      {rows === 1
        ? <Input id={`policy-${key}`} dir={rtl ? 'rtl' : 'ltr'} value={draft?.[key] ?? ''} onChange={e => setDraft(d => d && { ...d, [key]: e.target.value })} />
        : <Textarea id={`policy-${key}`} dir={rtl ? 'rtl' : 'ltr'} rows={rows} value={draft?.[key] ?? ''} onChange={e => setDraft(d => d && { ...d, [key]: e.target.value })} />}
    </div>
  );

  return (
    <SectionShell icon={FileCheck2} title={t('admin.policy.title', 'Consultant policy')}
      description={t('admin.policy.intro', 'Who has confirmed the Consultant Service Policy. After the grace period, consultants who have not confirmed cannot accept new assignments or place bids and are hidden from the directory, matching and Critical alerts until they confirm. Existing tickets continue.')}>
      {!ready && !q.isLoading && (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
          {t('admin.policy.sqlPending', 'The policy is not switched on yet (the prepared database update is not applied). Nothing is shown to consultants and nobody is restricted until it is applied.')}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {(['accepted', 'grace', 'pending', 'blocked'] as const).map(s => (
          <Card key={s} className="rounded-2xl"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{STATE_LABEL[s]}</p>
            <p className="text-2xl font-bold text-foreground">{counts[s] ?? 0}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin.policy.graceTitle', 'Grace period (policy_grace_days)')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="policy-grace-days">{t('admin.policy.graceDays', 'Days from first display before restrictions')}</Label>
            <Input id="policy-grace-days" type="number" min={0} max={MAX_POLICY_GRACE_DAYS} value={days} onChange={e => setDays(e.target.value)} className="w-28" disabled={!ready} />
          </div>
          <Button onClick={() => saveGrace.mutate()} disabled={!ready || saveGrace.isPending}>{t('common.save', 'Save')}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">{t('admin.policy.listTitle', 'Acknowledgements (current version {{v}})', { v: current.data?.policy.version ?? '-' })}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={t('admin.policy.search', 'Search name or e-mail')} placeholder={t('admin.policy.search', 'Search name or e-mail')} value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-48" />
            <Select value={filter} onValueChange={v => setFilter(v as PolicyFilter)}>
              <SelectTrigger className="h-9 w-48" aria-label={t('admin.policy.filter', 'Filter by status')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('admin.policy.all', 'All consultants')}</SelectItem>
                {(['accepted', 'grace', 'pending', 'blocked'] as const).map(s => <SelectItem key={s} value={s}>{STATE_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={!shown.length}><Download className="h-4 w-4" />{t('admin.policy.export', 'Export CSV')}</Button>
          </div>
        </CardHeader>
        <CardContent>
          {q.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</p>
            : !shown.length ? <p className="text-sm text-muted-foreground">{t('admin.policy.none', 'No consultants match.')}</p>
            : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('admin.policy.consultant', 'Consultant')}</TableHead>
                    <TableHead>{t('admin.policy.status', 'Status')}</TableHead>
                    <TableHead>{t('admin.policy.acceptedCol', 'Accepted')}</TableHead>
                    <TableHead>{t('admin.policy.firstShown', 'First shown')}</TableHead>
                    <TableHead>{t('admin.policy.deadline', 'Deadline')}</TableHead>
                    <TableHead>{t('admin.policy.lastReminder', 'Last reminder')}</TableHead>
                    <TableHead><span className="sr-only">{t('admin.policy.actions', 'Actions')}</span></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shown.map(r => (
                      <TableRow key={r.consultant_id} data-testid={`policy-row-${r.consultant_id}`}>
                        <TableCell><p className="text-sm font-medium">{r.display_name || t('admin.policy.noName', 'No name')}</p>{r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}</TableCell>
                        <TableCell><Badge variant="outline" className={STATE_TONE[r.state ?? ''] ?? ''}>{STATE_LABEL[r.state ?? 'none'] ?? r.state}</Badge></TableCell>
                        <TableCell className="text-xs">{r.accepted_version ? `v${r.accepted_version} · ${r.accepted_at ? format(new Date(r.accepted_at), 'PP') : ''}${r.accepted_language ? ` · ${r.accepted_language.toUpperCase()}` : ''}` : '-'}</TableCell>
                        <TableCell className="text-xs">{r.first_shown_at ? format(new Date(r.first_shown_at), 'PP') : '-'}</TableCell>
                        <TableCell className="text-xs">{r.deadline ? format(new Date(r.deadline), 'PP') : '-'}</TableCell>
                        <TableCell className="text-xs">{r.last_reminder_at ? format(new Date(r.last_reminder_at), 'PP p') : '-'}</TableCell>
                        <TableCell>
                          {r.state !== 'accepted' && (
                            <Button size="sm" variant="outline" className="gap-1" disabled={!ready || remind.isPending} onClick={() => remind.mutate(r.consultant_id)}>
                              <Send className="h-3.5 w-3.5" />{t('admin.policy.sendReminder', 'Send reminder')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">{t('admin.policy.publishTitle', 'Publish a new version')}</CardTitle>
          {!draft && <Button size="sm" onClick={startDraft} disabled={!ready || !current.data?.ready}>{t('admin.policy.startDraft', 'Edit the text for a new version')}</Button>}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('admin.policy.publishHelp', 'Published versions cannot be changed. A new version asks every consultant to confirm again: new consultants at registration, existing consultants by pop-up, banner and e-mail. Format: "## " starts a section, "- " a list item.')}</p>
          {draft && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {field('title_en', t('admin.policy.titleEn', 'Title (English)'), 1)}
                {field('title_ar', t('admin.policy.titleAr', 'Title (Arabic)'), 1, true)}
                {field('summary_en', t('admin.policy.summaryEn', 'Summary (English)'), 4)}
                {field('summary_ar', t('admin.policy.summaryAr', 'Summary (Arabic)'), 4, true)}
                {field('body_en', t('admin.policy.bodyEn', 'Text (English)'), 14)}
                {field('body_ar', t('admin.policy.bodyAr', 'Text (Arabic)'), 14, true)}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="policy-effective">{t('admin.policy.effective', 'Effective from (empty = now)')}</Label>
                <Input id="policy-effective" type="datetime-local" className="w-64" value={draft.effective} onChange={e => setDraft(d => d && { ...d, effective: e.target.value })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setConfirmOpen(true)} disabled={publish.isPending}>{t('admin.policy.publish', 'Publish version {{v}}', { v: (current.data?.policy.version ?? 0) + 1 })}</Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>{t('common.cancel', 'Cancel')}</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin.policy.audit', 'Audit trail')}</CardTitle></CardHeader>
        <CardContent>
          {!ready ? <p className="text-sm text-muted-foreground">-</p> : (
            <ul className="space-y-1.5 text-sm">
              {[
                ...(auditQ.data?.logs ?? []).map((l: any) => ({ id: l.id, at: l.created_at, text: l.action === 'consultant_policy.published' ? t('admin.policy.auditPublished', 'Version {{v}} published', { v: l.metadata?.version }) : l.action === 'consultant_policy.reminder_sent' ? t('admin.policy.auditReminder', 'Reminder sent (version {{v}})', { v: l.metadata?.version }) : l.action === 'consultant_policy.grace_days_changed' ? t('admin.policy.auditGrace', 'Grace period changed from {{from}} to {{to}} days', { from: l.metadata?.from, to: l.metadata?.to }) : l.action })),
                ...(auditQ.data?.acks ?? []).map(a => ({ id: a.id, at: a.accepted_at, text: t('admin.policy.auditAccepted', '{{name}} accepted version {{v}} ({{lang}}, {{source}})', { name: names.get(a.consultant_id) ?? a.consultant_id, v: a.version, lang: a.language.toUpperCase(), source: a.source }) })),
              ].sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 60).map(e => (
                <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-xs text-muted-foreground">{format(new Date(e.at), 'PP p')}</span><span>{e.text}</span></li>
              ))}
              {!auditQ.data?.logs.length && !auditQ.data?.acks.length && <li className="text-muted-foreground">{t('admin.policy.auditEmpty', 'Nothing yet.')}</li>}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.policy.confirmTitle', 'Publish version {{v}}?', { v: (current.data?.policy.version ?? 0) + 1 })}</AlertDialogTitle>
            <AlertDialogDescription>{t('admin.policy.confirmBody', 'Every consultant will be asked to confirm the new version. It cannot be edited or deleted after publishing.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.mutate()}>{t('admin.policy.publishNow', 'Publish')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
};

export default ConsultantPolicySection;

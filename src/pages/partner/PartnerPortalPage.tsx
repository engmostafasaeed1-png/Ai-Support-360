import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FlaskConical, UserPlus } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { DEMO_DETAILS, DEMO_RESOURCES, demoInvite, demoSetAvailability } from '@/lib/partnerDemo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { capacityConflict, partnerApi, type PartnerResource } from '@/lib/partnerPortal';

function SlaChip({ risk }: { risk: number }) {
  const { t } = useTranslation();
  return risk > 0 ? <Badge variant="destructive">{t('partner.sla_risk', '{{n}} at risk', { n: risk })}</Badge>
    : <Badge variant="secondary">{t('partner.sla_ok', 'On track')}</Badge>;
}

export default function PartnerPortalPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ctx = useQuery({ queryKey: ['partner-context'], queryFn: async () => (await partnerApi.context()).data ?? { partner: false, demo_default: false, admin: false } });
  const [demo, setDemo] = useState<boolean | null>(null);
  // Default ON for demo partner companies; admins without a partner company can only see the demo.
  useEffect(() => { if (ctx.data && demo === null) setDemo(ctx.data.demo_default || !ctx.data.partner); }, [ctx.data, demo]);
  const isDemo = demo === true;
  const [demoRows, setDemoRows] = useState(DEMO_RESOURCES);
  const real = useQuery({ queryKey: ['partner-overview'], enabled: demo === false, queryFn: async () => {
    const r = await partnerApi.overview(); if (r.error) throw new Error(r.error.message); return r.data ?? [];
  } });
  const list = isDemo ? { data: demoRows, isLoading: false, isError: false } : { data: real.data, isLoading: real.isLoading || demo === null, isError: real.isError };
  const demoToast = () => toast.info(t('partner.demo_toast', 'Demo: nothing is saved'));
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  const [cap, setCap] = useState('');
  const [holdFrom, setHoldFrom] = useState('');
  const [holdTo, setHoldTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<PartnerResource | null>(null);
  const rows = list.data ?? [];
  const active = rows.filter((r) => r.status === 'active');
  const refresh = () => qc.invalidateQueries({ queryKey: ['partner-overview'] });

  const invite = async () => {
    if (isDemo) { setDemoRows((rs) => demoInvite(rs, email.trim())); setEmail(''); return demoToast(); }
    setInviting(true);
    const r = await partnerApi.invite(email.trim());
    setInviting(false);
    if (r.error) return toast.error(r.error.message === 'rate_limited' ? t('partner.rate_limited', 'Too many invitations today. Try again tomorrow.') : t('partner.error', 'Could not save. Please try again.'));
    toast.success(r.data === 'invited' ? t('partner.invited', 'Invitation sent') : r.data === 'already' ? t('partner.already', 'Already invited or in your team')
      : t('partner.not_found', 'No consultant account uses this e-mail'));
    setEmail(''); refresh();
  };

  const apply = async () => {
    if (isDemo) {
      const res = demoSetAvailability(demoRows, [...sel], { status: status || null, capacity: cap === '' ? null : Number(cap),
        holdFrom: holdFrom ? new Date(holdFrom).toISOString() : null, holdTo: holdTo ? new Date(holdTo).toISOString() : null });
      setDemoRows(res.rows); demoToast();
      if (res.conflicts.length) toast.warning(t('partner.conflicts', 'Saved. {{n}} active agreement commitment(s) are affected: {{list}}', { n: res.conflicts.length, list: res.conflicts.map((c) => c.agreement).join(', ') }));
      setSel(new Set()); setStatus(''); setCap(''); setHoldFrom(''); setHoldTo(''); return;
    }
    setSaving(true);
    const r = await partnerApi.setAvailability([...sel], {
      status: status || null, capacity: cap === '' ? null : Number(cap),
      holdFrom: holdFrom ? new Date(holdFrom).toISOString() : null, holdTo: holdTo ? new Date(holdTo).toISOString() : null,
    });
    setSaving(false);
    if (r.error) return toast.error(r.error.message === 'invalid_hold' ? t('partner.invalid_hold', 'Hold must end after it starts and last at most 90 days.') : t('partner.error', 'Could not save. Please try again.'));
    const conflicts = r.data ?? [];
    if (conflicts.length) toast.warning(t('partner.conflicts', 'Saved. {{n}} active agreement commitment(s) are affected: {{list}}', { n: conflicts.length, list: conflicts.map((c) => c.agreement).join(', ') }));
    else toast.success(t('partner.saved', 'Saved'));
    setSel(new Set()); setStatus(''); setCap(''); setHoldFrom(''); setHoldTo(''); refresh();
  };

  const nothingChosen = !status && cap === '' && !holdFrom;
  const availReason = sel.size === 0 ? { key: 'fix_errors_first' as const, message: t('partner.select_first', 'Select at least one resource first.') }
    : nothingChosen ? { key: 'fix_errors_first' as const, message: t('partner.fill_first', 'Choose an availability, capacity or hold to apply.') } : undefined;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('partner.title', 'Partner portal')}</h1>
          <p className="text-sm text-muted-foreground">{t('partner.subtitle', 'Your consultants, their availability and assignments in one place')}</p>
        </div>
      </header>

      {(ctx.data?.partner || ctx.data?.admin || isDemo) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {(ctx.data?.partner || ctx.data?.admin) && <label className="flex items-center gap-2 text-sm font-medium">
            <Switch checked={isDemo} disabled={!ctx.data?.partner} /* disabled-ok: admins without a partner company have no real data to switch to */
              onCheckedChange={(v) => { setDemo(v); setSel(new Set()); setOpen(null); }} aria-label={t('partner.demo_switch', 'Demo data')} />
            {t('partner.demo_switch', 'Demo data')}
          </label>}
          {isDemo && <span className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-semibold text-foreground" role="status">
            <FlaskConical className="h-4 w-4" />{t('partner.demo_banner', 'Demo data - not real consultants')}</span>}
        </div>)}

      {list.isError ? <Card className="rounded-2xl"><CardContent className="p-6 text-sm text-muted-foreground">{t('partner.no_access', 'This page is for verified partner companies. Ask the platform team to enable your company.')}</CardContent></Card> : (
      <Tabs defaultValue="resources">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="resources">{t('partner.tab_resources', 'Resources')}</TabsTrigger>
          <TabsTrigger value="availability">{t('partner.tab_availability', 'Availability')}</TabsTrigger>
          <TabsTrigger value="assignments">{t('partner.tab_assignments', 'Assignments')}</TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="space-y-3">
          <Card className="rounded-2xl"><CardContent className="flex flex-col gap-2 p-4 sm:flex-row">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('partner.invite_ph', 'Consultant e-mail')} aria-label={t('partner.invite_ph', 'Consultant e-mail')} />
            <Button onClick={invite} busy={inviting} reason={!/^\S+@\S+\.\S+$/.test(email.trim()) && { key: 'fix_errors_first' as const, message: t('partner.email_first', 'Enter the consultant\'s e-mail address first.') }}>
              <UserPlus className="me-1 h-4 w-4" />{t('partner.invite', 'Invite consultant')}
            </Button>
          </CardContent></Card>
          <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
            {list.isLoading ? <Skeleton className="m-4 h-24" /> : rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{t('partner.empty', 'No resources yet. Invite your first consultant above.')}</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('partner.col_name', 'Name')}</TableHead><TableHead>{t('partner.col_status', 'Status')}</TableHead>
                <TableHead>{t('partner.col_availability', 'Availability')}</TableHead><TableHead>{t('partner.col_tickets', 'Active tickets')}</TableHead>
                <TableHead>{t('partner.col_sla', 'SLA')}</TableHead><TableHead>{t('partner.col_hours', 'Approved hours (month)')}</TableHead>
                <TableHead>{t('partner.col_earnings', 'Earnings status')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((r) => (
                <TableRow key={r.resource_id} className={r.status === 'active' ? 'cursor-pointer' : ''} onClick={() => r.status === 'active' && setOpen(r)}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant={r.status === 'active' ? 'default' : 'outline'}>{t(`partner.st_${r.status}`, r.status)}</Badge></TableCell>
                  <TableCell>{r.availability ? t(`partner.av_${r.availability}`, r.availability) : '—'}</TableCell>
                  <TableCell>{r.active_tickets}</TableCell>
                  <TableCell><SlaChip risk={r.sla_at_risk} /></TableCell>
                  <TableCell>{r.approved_hours_month}</TableCell>
                  <TableCell className="text-xs">{r.pending_hours_month > 0 ? t('partner.earn_pending', '{{h}} h awaiting approval', { h: r.pending_hours_month }) : t('partner.earn_ok', 'Up to date')}</TableCell>
                </TableRow>))}</TableBody>
            </Table>)}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="availability" className="space-y-3">
          <Card className="rounded-2xl"><CardContent className="grid gap-3 p-4 sm:grid-cols-5">
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('partner.col_availability', 'Availability')}>
              <option value="">{t('partner.keep', 'Keep availability')}</option>
              <option value="available">{t('partner.av_available', 'Open')}</option>
              <option value="busy">{t('partner.av_busy', 'Busy')}</option>
              <option value="offline">{t('partner.av_offline', 'Closed')}</option>
            </select>
            <Input type="number" min={0} max={80} value={cap} onChange={(e) => setCap(e.target.value)} placeholder={t('partner.capacity', 'Hours / week')} aria-label={t('partner.capacity', 'Hours / week')} />
            <Input type="date" value={holdFrom} onChange={(e) => setHoldFrom(e.target.value)} aria-label={t('partner.hold_from', 'Hold from')} />
            <Input type="date" value={holdTo} onChange={(e) => setHoldTo(e.target.value)} aria-label={t('partner.hold_to', 'Hold until')} />
            <Button onClick={apply} busy={saving} reason={availReason} hint="inline">{t('partner.apply', 'Apply to {{n}} selected', { n: sel.size })}</Button>
          </CardContent></Card>
          <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10"><Checkbox aria-label={t('partner.select_all', 'Select all')} checked={active.length > 0 && sel.size === active.length}
                  onCheckedChange={(v) => setSel(v ? new Set(active.map((r) => r.consultant_id)) : new Set())} /></TableHead>
                <TableHead>{t('partner.col_name', 'Name')}</TableHead><TableHead>{t('partner.col_availability', 'Availability')}</TableHead>
                <TableHead>{t('partner.capacity', 'Hours / week')}</TableHead><TableHead>{t('partner.hold', 'Hold')}</TableHead>
                <TableHead>{t('partner.conflict', 'Agreement conflict')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{active.map((r) => { const over = capacityConflict(r); return (
                <TableRow key={r.resource_id}>
                  <TableCell><Checkbox aria-label={r.name} checked={sel.has(r.consultant_id)} onCheckedChange={(v) => {
                    const n = new Set(sel); if (v) n.add(r.consultant_id); else n.delete(r.consultant_id); setSel(n); }} /></TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.availability ? t(`partner.av_${r.availability}`, r.availability) : '—'}</TableCell>
                  <TableCell>{r.capacity_hours_week ?? '—'}</TableCell>
                  <TableCell className="text-xs">{r.hold ? `${new Date(r.hold.from).toLocaleDateString()} – ${new Date(r.hold.to).toLocaleDateString()}` : '—'}</TableCell>
                  <TableCell>{over > 0 ? <Badge variant="destructive">{t('partner.over', '{{h}} h/week over', { h: over })}</Badge> : '—'}</TableCell>
                </TableRow>); })}</TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="assignments" className="space-y-3">
          {active.map((r) => <AssignmentsCard key={r.resource_id} r={r} demo={isDemo} />)}
          {active.length === 0 && <p className="text-sm text-muted-foreground">{t('partner.empty', 'No resources yet. Invite your first consultant above.')}</p>}
        </TabsContent>
      </Tabs>)}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader><SheetTitle>{open?.name}</SheetTitle></SheetHeader>
          {open && <ResourceDetail consultantId={open.consultant_id} demo={isDemo} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function useResource(id: string, demo: boolean) {
  const realQ = useQuery({ queryKey: ['partner-resource', id], enabled: !demo, queryFn: async () => {
    const r = await partnerApi.resource(id); if (r.error) throw new Error(r.error.message); return r.data ?? {};
  } });
  return demo ? { data: DEMO_DETAILS[id] ?? {}, isLoading: false } : realQ;
}

function AssignmentsCard({ r, demo }: { r: PartnerResource; demo: boolean }) {
  const { t } = useTranslation();
  const q = useResource(r.consultant_id, demo);
  const d = q.data as any;
  return (
    <Card className="rounded-2xl"><CardContent className="space-y-2 p-4">
      <p className="font-semibold">{r.name}</p>
      {q.isLoading ? <Skeleton className="h-10" /> : <>
        {(d?.agreements ?? []).map((a: any) => <p key={a.id} className="text-sm">{t('partner.agreement', 'Agreement')}: {a.name} ({a.ref}) · {a.role} · {a.capacity ?? '—'} h</p>)}
        {(d?.tickets ?? []).map((k: any) => <div key={k.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{k.title}</span><SlaChip risk={k.sla_breached ? 1 : 0} /></div>)}
        {!d?.agreements?.length && !d?.tickets?.length && <p className="text-sm text-muted-foreground">{t('partner.no_assignments', 'No current assignments')}</p>}
      </>}
    </CardContent></Card>
  );
}

function ResourceDetail({ consultantId, demo }: { consultantId: string; demo: boolean }) {
  const { t } = useTranslation();
  const q = useResource(consultantId, demo);
  const d = q.data as any;
  if (q.isLoading) return <Skeleton className="mt-4 h-40" />;
  if (!d) return null;
  const yes = (v: boolean) => (v ? t('partner.yes', 'Done') : t('partner.no', 'Missing'));
  const items: [string, string][] = [
    ...(d.modules ? [[t('partner.d_modules', 'Modules / versions'), String(d.modules)] as [string, string]] : []),
    [t('partner.d_verification', 'Verification'), String(d.verification ?? '—')],
    [t('partner.d_profile', 'Profile submitted'), yes(d.profile_submitted)],
    [t('partner.d_interview', 'AI interview'), yes(d.interview_done)],
    [t('partner.d_nda', 'Signed NDAs'), String(d.nda_signed ?? 0)],
    [t('partner.d_policy', 'Policy accepted'), yes(d.policy_accepted)],
    [t('partner.d_hours', 'Hours this month (approved / logged)'), `${d.hours_month?.approved ?? 0} / ${d.hours_month?.logged ?? 0}`],
    [t('partner.d_resp', 'Responsiveness'), d.responsiveness?.level ?? '—'],
    [t('partner.d_success', 'Success level'), d.success?.level ?? '—'],
    [t('partner.d_rating', 'Rating'), d.reviews ? `${Number(d.rating).toFixed(1)} (${d.reviews})` : '—'],
  ];
  return (
    <div className="mt-4 space-y-4">
      <dl className="grid grid-cols-2 gap-2 text-sm">{items.map(([k, v]) => <div key={k} className="rounded-xl bg-muted/50 p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t('partner.tab_assignments', 'Assignments')}</p>
        {(d.agreements ?? []).map((a: any) => <p key={a.id} className="text-sm">{a.name} ({a.ref}) · {a.status}</p>)}
        {(d.tickets ?? []).map((k: any) => <div key={k.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{k.title}</span><SlaChip risk={k.sla_breached ? 1 : 0} /></div>)}
        {!d.agreements?.length && !d.tickets?.length && <p className="text-sm text-muted-foreground">{t('partner.no_assignments', 'No current assignments')}</p>}
      </div>
    </div>
  );
}

// The client's support crew: plan it in the settings form (CrewEditor), manage it after the agreement (CrewPanel),
// and see who still has to accept the place, the SLA and the NDA (TeamConfirmation). Rules live in the database
// (sa_crew_problems / sa_confirmation); the browser only mirrors them through the shared model.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Circle, Clock, Loader2, Plus, ShieldCheck, Trash2, UserPlus, Users, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { safeRpc } from '@/lib/safeRpc';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import { useRefreshAgreements } from '@/hooks/useAgreements';
import * as api from '@/lib/agreements/api';
import {
  CREW_PICK_ROLES, crewProblems, newCrewEntry, saErrorCode,
  type CrewEntry, type CrewRole, type SaSettings, type WorkingHours,
} from '@/lib/agreements/model';
import NDASigningModal from '@/components/consultant/NDASigningModal';
import { fmtDate } from './AgreementBits';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Public display names (privacy format) for a list of consultant ids. */
export function useConsultantNames(ids: string[]) {
  const key = useMemo(() => [...new Set(ids)].sort().slice(0, 40), [ids]);
  const q = useQuery({
    queryKey: ['sa-names', key], enabled: key.length > 0, staleTime: 300_000,
    queryFn: async () => Object.fromEntries(await Promise.all(key.map(async (cid) => [cid, (await safeRpc<string>('consultant_public_name', { _consultant_id: cid })).data ?? '—'] as const))),
  });
  return (q.data ?? {}) as Record<string, string>;
}

/** Consultants the client can pick: favourites, members of the client's groups, applicants. */
export function useCrewCandidates(extra: Array<{ id: string; source: 'applicant' | 'matched' }> = []) {
  const favs = useClientFavourites();
  return useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (id: string, src: string) => { if (!favs.blocked.has(id)) m.set(id, new Set([...(m.get(id) ?? []), src])); };
    for (const id of favs.favourites.keys()) add(id, 'favourite');
    for (const g of favs.groups) if (!g.archived_at) for (const id of g.members) add(id, 'group');
    for (const e of extra) add(e.id, e.source);
    return [...m].map(([id, src]) => ({ id, sources: [...src] })).slice(0, 60);
  }, [favs.favourites, favs.groups, favs.blocked, extra]);
}

function WorkingHoursFields({ value, onChange, idBase }: { value: WorkingHours; onChange: (w: WorkingHours) => void; idBase: string }) {
  const { t } = useTranslation();
  const days = value.days ?? [];
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor={`${idBase}-tz`} className="text-xs">{t('agreements.crew.timezone')}</Label>
          <Input id={`${idBase}-tz`} className="h-8" value={value.timezone ?? ''} maxLength={64} placeholder="Asia/Riyadh" onChange={(e) => onChange({ ...value, timezone: e.target.value || undefined })} /></div>
        <div className="space-y-1"><Label htmlFor={`${idBase}-from`} className="text-xs">{t('agreements.crew.from')}</Label>
          <Input id={`${idBase}-from`} className="h-8" type="time" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} /></div>
        <div className="space-y-1"><Label htmlFor={`${idBase}-to`} className="text-xs">{t('agreements.crew.to')}</Label>
          <Input id={`${idBase}-to`} className="h-8" type="time" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} /></div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('agreements.crew.days')}>
        {DAYS.map((d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)}
            onClick={() => onChange({ ...value, days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() })}
            className={cn('rounded-full border px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', days.includes(d) ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted')}>
            {t(`agreements.crew.day${d}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function MemberFields({ e, onChange, others, names, idBase, lockRole }: {
  e: CrewEntry; onChange: (e: CrewEntry) => void; others: Array<{ id: string; label: string }>; names: Record<string, string>; idBase: string; lockRole?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1"><Label className="text-xs">{t('agreements.crew.role')}</Label>
        <Select value={e.role} disabled={lockRole} onValueChange={(v) => onChange({ ...e, role: v as CrewRole, required: v === 'backup' ? e.required ?? false : e.required ?? true })}>
          <SelectTrigger className="h-8" aria-label={t('agreements.crew.role')}><SelectValue /></SelectTrigger>
          <SelectContent>{(lockRole ? ['lead' as CrewRole] : CREW_PICK_ROLES).map((r) => <SelectItem key={r} value={r}>{t(`agreements.memberRole.${r}`)}</SelectItem>)}</SelectContent>
        </Select></div>
      <div className="space-y-1"><Label htmlFor={`${idBase}-cap`} className="text-xs">{t('agreements.crew.capacity')}</Label>
        <Input id={`${idBase}-cap`} className="h-8" type="number" min={0} max={60} step={0.5} value={e.capacity_hours_per_week ?? ''}
          onChange={(x) => onChange({ ...e, capacity_hours_per_week: x.target.value === '' ? null : Number(x.target.value) })} /></div>
      <div className="space-y-1"><Label className="text-xs">{t('agreements.crew.backupFor')}</Label>
        <Select value={e.backup_for ?? 'none'} onValueChange={(v) => onChange({ ...e, backup_for: v === 'none' ? null : v })}>
          <SelectTrigger className="h-8" aria-label={t('agreements.crew.backupFor')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">{t('agreements.crew.noBackup')}</SelectItem>
            {others.filter((o) => o.id !== e.consultant_id).map((o) => <SelectItem key={o.id} value={o.id}>{o.label || names[o.id] || '—'}</SelectItem>)}</SelectContent>
        </Select></div>
      <label className="flex items-center gap-2 self-end pb-1 text-xs"><Switch checked={e.required !== false} disabled={lockRole} onCheckedChange={(v) => onChange({ ...e, required: v })} /> {t('agreements.crew.required')}</label>
      <div className="sm:col-span-2 lg:col-span-4"><WorkingHoursFields idBase={idBase} value={e.working_hours ?? {}} onChange={(w) => onChange({ ...e, working_hours: w })} /></div>
    </div>
  );
}

/** Settings form: plan the crew (the lead is the applicant the client selects later). */
export function CrewEditor({ value, onChange, settings, applicants = [] }: {
  value: CrewEntry[]; onChange: (v: CrewEntry[]) => void; settings: SaSettings; applicants?: string[];
}) {
  const { t } = useTranslation();
  const candidates = useCrewCandidates(useMemo(() => applicants.map((id) => ({ id, source: 'applicant' as const })), [applicants]));
  const names = useConsultantNames([...candidates.map((c) => c.id), ...value.map((e) => e.consultant_id)]);
  const [pick, setPick] = useState('');
  const problems = crewProblems(value, null, settings);
  const others = value.map((e) => ({ id: e.consultant_id, label: names[e.consultant_id] ?? '' }));
  const free = candidates.filter((c) => !value.some((e) => e.consultant_id === c.id));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('agreements.crew.planHint', { max: settings.crew_max - 1 })}</p>
      {value.map((e, i) => (
        <div key={e.consultant_id} className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{names[e.consultant_id] ?? '…'}</p>
            <Button type="button" size="sm" variant="ghost" aria-label={t('agreements.crew.remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <MemberFields idBase={`crew-${i}`} e={e} names={names} others={others} onChange={(n) => onChange(value.map((x, j) => (j === i ? n : x)))} />
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1 space-y-1"><Label className="text-xs">{t('agreements.crew.add')}</Label>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-9" aria-label={t('agreements.crew.add')}><SelectValue placeholder={free.length ? t('agreements.crew.pick') : t('agreements.crew.noCandidates')} /></SelectTrigger>
            <SelectContent>{free.map((c) => <SelectItem key={c.id} value={c.id}>{names[c.id] ?? '…'} · {c.sources.map((s) => t(`agreements.crew.src.${s}`)).join(', ')}</SelectItem>)}</SelectContent>
          </Select></div>
        <Button type="button" variant="outline" disabled={!pick || value.length >= settings.crew_max - 1} onClick={() => { onChange([...value, newCrewEntry(pick)]); setPick(''); }}>
          <Plus className="me-1 h-4 w-4" />{t('agreements.crew.addCta')}</Button>
      </div>
      {problems.length > 0 && <ul className="text-xs text-destructive">{problems.map((p) => <li key={p}>• {t(`agreements.problem.${p}`, { defaultValue: p, max: settings.crew_max })}</li>)}</ul>}
    </div>
  );
}

const ITEM_ICON = (ok: boolean) => (ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />);

/** "Team confirmation" checklist: what still blocks the start, and each member's place / SLA / NDA status. */
export function TeamConfirmation({ a, lang }: { a: api.SaDetail; lang: 'en' | 'ar' }) {
  const { t } = useTranslation();
  const refresh = useRefreshAgreements();
  const [ndaOpen, setNdaOpen] = useState(false);
  const myId = a.role === 'lead' ? a.consultant_id ?? null : a.role === 'team' ? a.my_member?.consultant_id ?? null : null;
  const c = a.confirmation;
  if (!c) return null;
  const live = ['active', 'renewal_due', 'suspended'].includes(a.status);
  const items = c.items.filter((i) => i.needed !== false && (i.key !== 'admin_review' || i.needed));
  return (
    <Card className={cn('rounded-2xl', !live && !c.ready && 'border-info/40')}>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />{t('agreements.teamConfirm.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{live ? t('agreements.teamConfirm.live') : t('agreements.teamConfirm.slaStarts')}</p></CardHeader>
      <CardContent className="space-y-4">
        {!live && (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('agreements.teamConfirm.title')}>
            {items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-sm">{ITEM_ICON(i.ok)}
                <span>{t(`agreements.teamConfirm.item.${i.key}`, { date: fmtDate(i.date ?? null, lang) })}</span></li>
            ))}
          </ul>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground">
              <th className="p-2 text-start">{t('agreements.crew.member')}</th><th className="p-2 text-start">{t('agreements.crew.role')}</th>
              <th className="p-2 text-start">{t('agreements.crew.place')}</th><th className="p-2 text-start">{t('agreements.crew.sla')}</th><th className="p-2 text-start">{t('agreements.crew.nda')}</th>
            </tr></thead>
            <tbody>
              {c.members.map((m) => (
                <tr key={m.consultant_id} className="border-t">
                  <td className="p-2 font-medium">{m.name ?? '—'}{!m.required && <span className="ms-1 text-xs font-normal text-muted-foreground">({t('agreements.crew.optional')})</span>}</td>
                  <td className="p-2">{t(`agreements.memberRole.${m.role}`, { defaultValue: m.role })}{m.capacity_hours_per_week ? <span className="block text-xs text-muted-foreground">{t('agreements.f.hoursWeek', { count: m.capacity_hours_per_week })}</span> : null}</td>
                  <td className="p-2"><Badge variant="outline" className={cn(m.status === 'active' && 'border-success/50 text-success', m.status === 'declined' && 'border-destructive/50 text-destructive')}>
                    {m.status === 'active' ? <CheckCircle2 className="me-1 h-3 w-3" aria-hidden /> : m.status === 'declined' ? <XCircle className="me-1 h-3 w-3" aria-hidden /> : <Clock className="me-1 h-3 w-3" aria-hidden />}
                    {t(`agreements.memberStatus.${m.status}`, { defaultValue: m.status })}</Badge></td>
                  <td className="p-2 text-xs">{m.sla_accepted_at ? t('agreements.crew.slaOn', { date: fmtDate(m.sla_accepted_at, lang), v: m.sla_version ?? '—' }) : t('agreements.crew.pending')}</td>
                  <td className="p-2 text-xs">{!a.terms?.nda_required ? t('agreements.crew.ndaNotNeeded') : m.nda_ok ? t('agreements.crew.ndaOn', { date: fmtDate(m.nda_signed_at, lang) }) : t('agreements.crew.ndaMissing')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.terms?.nda_required && c.members.some((m) => m.status === 'active' && !m.nda_ok) && (
          myId && a.client_id && c.members.some((m) => m.consultant_id === myId && m.status === 'active' && !m.nda_ok) ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{t('agreements.teamConfirm.ndaYours')}</span>
              <Button size="sm" variant="outline" onClick={() => setNdaOpen(true)}>{t('agreements.teamConfirm.ndaSign')}</Button></div>
          ) : ['client', 'client_member'].includes(a.role) ? (
            <p className="text-xs text-muted-foreground">{t('agreements.teamConfirm.ndaClient')} <Link className="text-primary underline-offset-2 hover:underline" to="/client/contracts">{t('agreements.teamConfirm.ndaLink')}</Link></p>
          ) : <p className="text-xs text-muted-foreground">{t('agreements.teamConfirm.ndaHow')}</p>
        )}
        {myId && a.client_id && ndaOpen && (
          <NDASigningModal open={ndaOpen} onOpenChange={setNdaOpen} consultantId={myId} clientId={a.client_id} onSigned={() => { setNdaOpen(false); refresh(); }} />
        )}
      </CardContent>
    </Card>
  );
}

/** After the agreement: the client invites/edits/removes members; an invited member accepts place + SLA here. */
export function CrewPanel({ a, settings }: { a: api.SaDetail; settings: SaSettings }) {
  const { t } = useTranslation();
  const refresh = useRefreshAgreements();
  const isClient = a.role === 'client';
  const members = (a.confirmation?.members ?? a.members ?? []).filter((m) => m.status !== 'ended');
  const names = useConsultantNames(members.map((m) => m.consultant_id));
  const candidates = useCrewCandidates();
  const candNames = useConsultantNames(candidates.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ entry: CrewEntry; isNew: boolean; lead: boolean } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [slaOk, setSlaOk] = useState(false);
  const [typed, setTyped] = useState('');
  const canManage = isClient && ['agreed', 'active', 'renewal_due', 'suspended'].includes(a.status);
  const others = members.map((m) => ({ id: m.consultant_id, label: m.name ?? names[m.consultant_id] ?? '' }));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); return true; }
    catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); return false; }
    finally { setBusy(false); }
  };
  const details = (e: CrewEntry): api.CrewDetails => ({ role: e.role, capacity: e.capacity_hours_per_week ?? null, workingHours: e.working_hours ?? {}, backupFor: e.backup_for ?? null, required: e.required !== false });
  const mine = a.my_member;
  const free = candidates.filter((c) => !members.some((m) => m.consultant_id === c.id));

  return (
    <div className="space-y-4">
      {mine?.status === 'invited' && (
        <Card className="rounded-2xl border-primary/40"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4 text-primary" aria-hidden />{t('agreements.crew.invitedTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{t('agreements.crew.invitedText', { role: t(`agreements.memberRole.${mine.role}`, { defaultValue: mine.role }), hours: mine.capacity_hours_per_week ?? '—' })}</p>
            <div className="rounded-xl border bg-muted/40 p-3"><p className="text-xs font-medium">{t('agreements.crew.slaToAccept')}</p>
              <p className="mt-1 text-sm">{a.terms?.sla.summary || t('agreements.f.slaDefault')}</p></div>
            <label className="flex items-start gap-2"><Checkbox checked={slaOk} onCheckedChange={(v) => setSlaOk(!!v)} className="mt-0.5" /> {t('agreements.crew.acceptCheck')}</label>
            <div className="max-w-sm space-y-1.5"><Label htmlFor="crew-name">{t('agreements.acc.name')}</Label><Input id="crew-name" value={typed} maxLength={120} autoComplete="name" onChange={(e) => setTyped(e.target.value)} /></div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !slaOk || typed.trim().length < 2} onClick={() => run(() => api.memberRespond(a.id, true, true, typed.trim()), t('agreements.crew.accepted'))}>
                {busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('agreements.crew.acceptCta')}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => run(() => api.memberRespond(a.id, false, false, ''), t('agreements.crew.declined'))}>{t('agreements.decline')}</Button>
            </div>
            {a.terms?.nda_required && <p className="text-xs text-muted-foreground">{t('agreements.crew.ndaAfter')}</p>}
          </CardContent></Card>
      )}

      <Card className="rounded-2xl"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" aria-hidden />{t('agreements.crew.title')}</CardTitle>
        {canManage && <Button size="sm" variant="outline" disabled={!free.length || members.length >= settings.crew_max} onClick={() => setEdit({ entry: newCrewEntry(free[0]?.id ?? ''), isNew: true, lead: false })}><Plus className="me-1 h-4 w-4" />{t('agreements.crew.addCta')}</Button>}</CardHeader>
        <CardContent className="space-y-2">
          {!members.length && <p className="text-sm text-muted-foreground">{t('agreements.crew.none')}</p>}
          {members.map((m) => (
            <div key={m.consultant_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
              <div><p className="font-medium">{m.name ?? names[m.consultant_id] ?? '—'} · {t(`agreements.memberRole.${m.role}`, { defaultValue: m.role })}</p>
                <p className="text-xs text-muted-foreground">
                  {m.capacity_hours_per_week ? `${t('agreements.f.hoursWeek', { count: m.capacity_hours_per_week })} · ` : ''}
                  {m.working_hours?.from && m.working_hours?.to ? `${m.working_hours.from}–${m.working_hours.to}` : ''}{m.working_hours?.timezone ? ` (${m.working_hours.timezone})` : ''}
                  {m.backup_for ? ` · ${t('agreements.crew.covers', { name: others.find((o) => o.id === m.backup_for)?.label || '—' })}` : ''}
                </p></div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{t(`agreements.memberStatus.${m.status}`, { defaultValue: m.status })}</Badge>
                {canManage && <Button size="sm" variant="ghost" onClick={() => setEdit({ entry: { consultant_id: m.consultant_id, role: m.role as CrewRole, capacity_hours_per_week: m.capacity_hours_per_week, working_hours: m.working_hours ?? {}, backup_for: m.backup_for, required: m.required }, isNew: false, lead: m.role === 'lead' })}>{t('agreements.crew.edit')}</Button>}
                {canManage && m.role !== 'lead' && <Button size="sm" variant="ghost" aria-label={t('agreements.crew.remove')} onClick={() => setRemoveId(m.consultant_id)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
          ))}
          {a.role === 'team' && mine?.status === 'active' && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoveId('self')}>{t('agreements.crew.leave')}</Button>
          )}
        </CardContent></Card>

      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{edit?.isNew ? t('agreements.crew.addCta') : t('agreements.crew.edit')}</DialogTitle><DialogDescription>{t('agreements.crew.dialogText')}</DialogDescription></DialogHeader>
          {edit && (
            <div className="space-y-3">
              {edit.isNew && (
                <div className="space-y-1"><Label className="text-xs">{t('agreements.crew.member')}</Label>
                  <Select value={edit.entry.consultant_id} onValueChange={(v) => setEdit({ ...edit, entry: { ...edit.entry, consultant_id: v } })}>
                    <SelectTrigger aria-label={t('agreements.crew.member')}><SelectValue placeholder={t('agreements.crew.pick')} /></SelectTrigger>
                    <SelectContent>{free.map((c) => <SelectItem key={c.id} value={c.id}>{candNames[c.id] ?? '…'}</SelectItem>)}</SelectContent>
                  </Select></div>
              )}
              <MemberFields idBase="crew-dlg" e={edit.entry} names={{ ...names, ...candNames }} others={others} lockRole={edit.lead} onChange={(n) => setEdit({ ...edit, entry: n })} />
            </div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setEdit(null)}>{t('agreements.cancel')}</Button>
            <Button disabled={busy || !edit?.entry.consultant_id} onClick={async () => {
              if (!edit) return;
              const ok = await run(() => (edit.isNew ? api.inviteMember(a.id, edit.entry.consultant_id, details(edit.entry)) : api.updateMember(a.id, edit.entry.consultant_id, details(edit.entry))),
                edit.isNew ? t('agreements.crew.invited') : t('agreements.saved'));
              if (ok) setEdit(null);
            }}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{edit?.isNew ? t('agreements.crew.inviteCta') : t('agreements.save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removeId} onOpenChange={(v) => { if (!v) { setRemoveId(null); setReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{removeId === 'self' ? t('agreements.crew.leave') : t('agreements.crew.remove')}</DialogTitle><DialogDescription>{t('agreements.crew.removeText')}</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="crew-reason">{t('agreements.dlg.reason')}</Label><Textarea id="crew-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <DialogFooter><Button variant="ghost" onClick={() => setRemoveId(null)}>{t('agreements.cancel')}</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={async () => {
              const target = removeId === 'self' ? (a.my_member?.consultant_id ?? '') : removeId!;
              const ok = await run(() => api.removeMember(a.id, target, reason.trim()), t('agreements.saved'));
              if (ok) { setRemoveId(null); setReason(''); }
            }}>{t('agreements.confirm')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

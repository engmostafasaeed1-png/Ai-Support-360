import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, History, ShieldCheck, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSlaSettings, useSlaTicketAction, useTicketSla } from '@/hooks/useSla';
import * as api from '@/lib/sla/api';
import { formatMinutes, formatTarget, hoursPerDay, SEVERITY_KEYS, type SeverityKey } from '@/lib/sla/policy';
import { SlaClockChip } from './SlaChips';
import { clockView, coverageText, fmtAt, langOf, slaErrorText } from './slaUi';

type Dlg = null | 'ack' | 'workaround' | 'reclass' | 'propose' | 'extend';

/** SLA of one ticket: snapshot, clocks, actions by role and the SLA timeline. Hidden while off or without a snapshot. */
export default function SlaTicketPanel({ ticketId }: { ticketId: string }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const { data } = useTicketSla(ticketId);
  const settings = useSlaSettings().data;
  const [dlg, setDlg] = useState<Dlg>(null);
  const [note, setNote] = useState('');
  const [eta, setEta] = useState('');
  const [sev, setSev] = useState<SeverityKey>('S2');
  const [extendClock, setExtendClock] = useState('resolution');
  const [extendMin, setExtendMin] = useState('240');
  const act = useSlaTicketAction(ticketId, async (fn: () => Promise<unknown>) => fn());

  if (!data?.snapshot) return null;
  const s = data.snapshot;
  const cal = s.data.calendar;
  const atRisk = settings?.at_risk_pct ?? 75;
  const hpd = hoursPerDay(cal);
  const target = (m: number | null) => (m ? formatTarget(m, cal.mode, hpd, lang) : '—');
  const breached = data.clocks.filter((c) => c.breached_at && !c.met_at);
  const sevLabel = (k: SeverityKey) => {
    const d = settings?.severities.find((x) => x.key === k);
    return `${k} ${d ? (lang === 'ar' ? d.label_ar : d.label_en) : ''}`.trim();
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await act.mutateAsync(fn);
      toast.success(ok);
      setDlg(null); setNote(''); setEta('');
    } catch (e) {
      toast.error(slaErrorText(t, e));
    }
  };

  return (
    <Card className="rounded-2xl border-border/50" data-testid="sla-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> {t('sla.panel.title')}
          <Badge variant="outline" className="text-[10px]">{t('sla.panel.snapshot', { version: s.version })}</Badge>
          <Badge variant="secondary" className="text-[10px]">{sevLabel(s.severity)}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{s.policy_name} · {coverageText(t, cal)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {data.clocks.map((c) => <SlaClockChip key={c.kind} clock={c} calendar={cal} atRiskPct={atRisk} />)}
          {data.role === 'candidate' && <span className="text-xs text-muted-foreground">{t('sla.panel.candidateHint')}</span>}
        </div>

        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          {(['response', 'workaround', 'resolution'] as const).map((k) => {
            const m = (s.data as unknown as Record<string, number | null>)[`${k}_min`];
            if (!m) return null;
            const c = data.clocks.find((x) => x.kind === k);
            const v = c ? clockView(c, cal, atRisk) : null;
            return (
              <div key={k} className="rounded-xl bg-muted/40 p-2.5">
                <dt className="text-muted-foreground">{t(`sla.clock.${k}`)}</dt>
                <dd className="font-semibold text-foreground">{target(m)}</dd>
                {c && v && <dd className="text-muted-foreground">{t('sla.panel.used', { used: formatMinutes(c.consumed_now, lang) })}{c.due_at && !c.met_at ? ` · ${t('sla.chip.due', { at: fmtAt(c.due_at, cal.tz, lang) })}` : ''}</dd>}
                {c && c.extended_min > 0 && <dd className="text-muted-foreground">{t('sla.panel.extended', { min: formatMinutes(c.extended_min, lang) })}</dd>}
              </div>
            );
          })}
        </dl>
        {s.data.premium_capped && <p className="rounded-xl bg-warning/15 px-3 py-2 text-xs text-foreground">{t('sla.panel.premiumCapped')}</p>}
        {s.data.counter_offer && <p className="text-xs text-muted-foreground">{t('sla.panel.counterApplied')}</p>}

        {/* Client: newer policy, pending re-classification and counter-proposals, breach choices */}
        {data.can.apply_policy && data.newer_policy && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 p-3 text-xs">
            <span className="flex-1">{t('sla.panel.newer', { name: data.newer_policy.name, version: data.newer_policy.version })}</span>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.applyNewPolicy(ticketId, ''), t('sla.panel.applied'))}>{t('sla.panel.applyNew')}</Button>
          </div>
        )}
        {data.can.decide && data.reclass && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-xs">
            <span className="flex-1">{t('sla.panel.reclassAsk', { from: data.reclass.from, to: data.reclass.to, reason: data.reclass.reason })}</span>
            <Button size="sm" disabled={act.isPending} onClick={() => run(() => api.decideReclass(data.reclass!.id, true), t('sla.panel.saved'))}>{t('sla.action.accept')}</Button>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.decideReclass(data.reclass!.id, false), t('sla.panel.saved'))}>{t('sla.action.decline')}</Button>
          </div>
        )}
        {data.can.decide && (data.counters ?? []).map((k) => (
          <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 p-3 text-xs">
            <span className="flex-1">{t('sla.panel.counterAsk', { response: target(k.targets.response_min), resolution: target(k.targets.resolution_min) })}{k.note ? ` — ${k.note}` : ''}</span>
            <Button size="sm" disabled={act.isPending} onClick={() => run(() => api.decideCounter(k.id, true, ''), t('sla.panel.saved'))}>{t('sla.action.accept')}</Button>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.decideCounter(k.id, false, ''), t('sla.panel.saved'))}>{t('sla.action.decline')}</Button>
          </div>
        ))}
        {data.can.breach_choice && breached.length > 0 && (
          <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-foreground"><AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden /> {t('sla.panel.breachedAsk')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setExtendClock(breached[0].kind); setDlg('extend'); }}>{t('sla.choice.extend')}</Button>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.breachChoice(ticketId, breached[0].kind, 'reassign', null, ''), t('sla.panel.sentAdmin'))}>{t('sla.choice.reassign')}</Button>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.breachChoice(ticketId, breached[0].kind, 'admin_help', null, ''), t('sla.panel.sentAdmin'))}>{t('sla.choice.admin_help')}</Button>
            </div>
          </div>
        )}

        {/* Consultant + admin actions */}
        <div className="flex flex-wrap gap-2">
          {data.can.acknowledge && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDlg('ack')}><CheckCircle2 className="me-1 h-3.5 w-3.5" aria-hidden /> {t('sla.action.ack')}</Button>}
          {data.can.workaround && data.clocks.some((c) => c.kind === 'workaround' && !c.met_at && c.started_at) && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDlg('workaround')}>{t('sla.action.workaround')}</Button>
          )}
          {data.can.propose_reclass && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDlg('propose')}>{t('sla.action.proposeReclass')}</Button>}
          {data.can.reclassify && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setSev(s.severity); setDlg('reclass'); }}>{t('sla.action.reclassify')}</Button>}
        </div>

        <SlaTimeline events={data.events} tz={cal.tz} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t('sla.disclaimer')}</p>
      </CardContent>

      <Dialog open={dlg !== null} onOpenChange={(o) => { if (!o) setDlg(null); }}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>{dlg ? t(`sla.dialog.${dlg}.title`) : ''}</DialogTitle>
            <DialogDescription>{dlg ? t(`sla.dialog.${dlg}.text`) : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(dlg === 'reclass' || dlg === 'propose') && (
              <div className="space-y-1">
                <Label htmlFor="sla-sev">{t('sla.dialog.severity')}</Label>
                <Select value={sev} onValueChange={(v) => setSev(v as SeverityKey)}>
                  <SelectTrigger id="sla-sev"><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITY_KEYS.filter((k) => dlg === 'reclass' || k !== s.severity).map((k) => <SelectItem key={k} value={k}>{sevLabel(k)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {dlg === 'extend' && (
              <div className="space-y-1">
                <Label htmlFor="sla-ext">{t('sla.dialog.extendBy')}</Label>
                <Select value={extendMin} onValueChange={setExtendMin}>
                  <SelectTrigger id="sla-ext"><SelectValue /></SelectTrigger>
                  <SelectContent>{['60', '120', '240', '480', '960', '1440'].map((m) => <SelectItem key={m} value={m}>{formatMinutes(Number(m), lang)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {dlg === 'ack' && (
              <div className="space-y-1">
                <Label htmlFor="sla-eta">{t('sla.dialog.eta')}</Label>
                <Input id="sla-eta" type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="sla-note">{dlg === 'reclass' || dlg === 'propose' ? t('sla.dialog.reason') : t('sla.dialog.note')}</Label>
              <Textarea id="sla-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={3} />
              <p className="text-[11px] text-muted-foreground">{t('sla.dialog.noContact')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>{t('sla.action.cancel')}</Button>
            <Button disabled={act.isPending || ((dlg === 'reclass' || dlg === 'propose') && note.trim().length < 3)} onClick={() => {
              if (dlg === 'ack') void run(() => api.acknowledgeSla(ticketId, note, eta ? new Date(eta).toISOString() : null), t('sla.panel.acked'));
              if (dlg === 'workaround') void run(() => api.markWorkaround(ticketId, note), t('sla.panel.saved'));
              if (dlg === 'reclass') void run(() => api.reclassify(ticketId, sev, note), t('sla.panel.saved'));
              if (dlg === 'propose') void run(() => api.proposeReclass(ticketId, sev, note), t('sla.panel.proposed'));
              if (dlg === 'extend') void run(() => api.breachChoice(ticketId, extendClock, 'extend', Number(extendMin), note), t('sla.panel.saved'));
            }}>{t('sla.action.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function eventText(t: ReturnType<typeof useTranslation>['t'], kind: string, d: Record<string, unknown>, tz: string, lang: 'en' | 'ar') {
  const clock = d.clock ? t(`sla.clock.${d.clock}`) : '';
  const params = {
    clock, reason: d.reason ? t(`sla.pause.${d.reason}`, { defaultValue: String(d.reason) }) : '', to: d.to ? t(`sla.role.${d.to}`, { defaultValue: String(d.to) }) : '',
    severity: d.severity ?? '', from: d.from ?? '', version: d.version ?? '', policy: d.policy ?? '', note: d.note ?? '',
    choice: d.choice ? t(`sla.choice.${d.choice}`) : '', eta: d.eta ? fmtAt(String(d.eta), tz, lang) : '',
  };
  const text = t(`sla.event.${kind}`, { ...params, defaultValue: kind });
  return kind === 'acknowledged' && params.eta ? `${text} · ${t('sla.event.eta', { eta: params.eta })}` : text;
}

export function SlaTimeline({ events, tz }: { events: api.SlaEvent[]; tz: string }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const [open, setOpen] = useState(false);
  if (!events.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs"><History className="h-3.5 w-3.5" aria-hidden /> {t('sla.panel.timeline', { count: events.length })}</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 space-y-1.5 border-s border-border ps-3">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="text-xs">
              <span className="text-muted-foreground">{fmtAt(e.at, tz, lang)} · {t(`sla.role.${e.role}`, { defaultValue: e.role })}</span>
              <p className="text-foreground"><Timer className="me-1 inline h-3 w-3 text-muted-foreground" aria-hidden />{eventText(t, e.kind, e.data, tz, lang)}</p>
              {e.kind === 'acknowledged' && typeof e.data.note === 'string' && e.data.note && <p className="whitespace-pre-wrap text-muted-foreground">{e.data.note}</p>}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

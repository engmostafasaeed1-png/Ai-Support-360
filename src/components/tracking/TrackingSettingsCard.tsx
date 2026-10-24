import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ListChecks } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminSetTrackingSettings, adminTrackingOverview } from '@/lib/tracking/api';
import { REQUIRED_KEYS, TT_COLORS, normalizeSettings, settingsProblems, type TrackingSettings } from '@/lib/ticketTracking';
import { CHIP, ICON, STATUS_ICONS } from './trackingStyles';

const NUMBERS = ['note_max', 'rate_limit_per_hour', 'throttle_minutes', 'review_reminder_days', 'max_review_reminders', 'max_overdue_reminders', 'stuck_days'] as const;

/** Admin: "Ticket tracking enabled" (default off), working status list (labels EN/AR, colour, order, on/off),
 *  who-can-set matrix, note rules, reminder cadence. Saved only through tt_admin_set_settings (audited). */
export default function TrackingSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TrackingSettings | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await adminTrackingOverview();
    if (r.error) { setNotReady(true); return; }
    setDraft(normalizeSettings(r.data?.settings));
  };
  useEffect(() => { void load(); }, []);

  if (notReady) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ListChecks className="h-4 w-4 text-primary" /> {t('tracking.admin.title')}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{t('tracking.admin.notReady')}</p></CardContent>
      </Card>
    );
  }
  if (!draft) return null;

  const set = (patch: Partial<TrackingSettings>) => setDraft({ ...draft, ...patch });
  const setStatus = (i: number, patch: Partial<TrackingSettings['statuses'][number]>) =>
    set({ statuses: draft.statuses.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const list = [...draft.statuses];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ statuses: list.map((s, k) => ({ ...s, order: (k + 1) * 10 })) });
  };
  const setRule = (key: string, field: 'client' | 'consultant' | 'note', v: boolean) =>
    set({ matrix: { ...draft.matrix, [key]: { ...(draft.matrix[key] ?? { client: false, consultant: false, note: false }), [field]: v } } });
  const problems = settingsProblems(draft);

  const save = async () => {
    if (problems.length) { toast.error(t('tracking.admin.invalid')); return; }
    setBusy(true);
    const r = await adminSetTrackingSettings(draft as unknown as Record<string, unknown>, reason.trim());
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    toast.success(t('tracking.admin.saved'));
    setReason('');
    void qc.invalidateQueries({ queryKey: ['ticket-tracking'] });
    void qc.invalidateQueries({ queryKey: ['ticket-tracking-settings'] });
    void qc.invalidateQueries({ queryKey: ['tt-admin-overview'] });
    void load();
  };

  return (
    <Card className="rounded-2xl border-border/50" data-testid="tracking-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ListChecks className="h-4 w-4 text-primary" /> {t('tracking.admin.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('tracking.admin.desc')}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm"><Switch checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v })} /> {t('tracking.admin.enabled')}</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={draft.email_enabled} onCheckedChange={(v) => set({ email_enabled: v })} /> {t('tracking.admin.email')}</label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NUMBERS.map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`tt-${k}`} className="text-xs">{t(`tracking.admin.n_${k}`)}</Label>
              <Input id={`tt-${k}`} type="number" min={0} value={draft[k]} onChange={(e) => set({ [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } as Partial<TrackingSettings>)} />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('tracking.admin.statuses')}</p>
          <p className="text-xs text-muted-foreground">{t('tracking.admin.statusesHint')}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="p-1 text-start">{t('tracking.admin.order')}</th>
                  <th className="p-1 text-start">{t('tracking.admin.labelEn')}</th>
                  <th className="p-1 text-start">{t('tracking.admin.labelAr')}</th>
                  <th className="p-1 text-start">{t('tracking.admin.color')}</th>
                  <th className="p-1">{t('tracking.admin.on')}</th>
                  <th className="p-1">{t('tracking.admin.client')}</th>
                  <th className="p-1">{t('tracking.admin.consultant')}</th>
                  <th className="p-1">{t('tracking.admin.noteReq')}</th>
                </tr>
              </thead>
              <tbody>
                {draft.statuses.map((s, i) => {
                  const Icon = STATUS_ICONS[s.icon];
                  const rule = draft.matrix[s.key] ?? { client: false, consultant: false, note: false };
                  const locked = (REQUIRED_KEYS as readonly string[]).includes(s.key);
                  return (
                    <tr key={s.key} className="border-t border-border/50">
                      <td className="p-1">
                        <div className="flex items-center gap-0.5">
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('tracking.admin.up')} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('tracking.admin.down')} onClick={() => move(i, 1)} disabled={i === draft.statuses.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                          <span className={`ms-1 inline-flex h-6 w-6 items-center justify-center rounded-full border ${CHIP[s.color]}`}><Icon className={`h-3 w-3 ${ICON[s.color]}`} aria-hidden /></span>
                        </div>
                      </td>
                      <td className="p-1"><Input value={s.label_en} maxLength={60} onChange={(e) => setStatus(i, { label_en: e.target.value })} aria-label={`${t('tracking.admin.labelEn')} ${s.key}`} className="h-8" /></td>
                      <td className="p-1"><Input dir="rtl" value={s.label_ar} maxLength={60} onChange={(e) => setStatus(i, { label_ar: e.target.value })} aria-label={`${t('tracking.admin.labelAr')} ${s.key}`} className="h-8" /></td>
                      <td className="p-1">
                        <Select value={s.color} onValueChange={(v) => setStatus(i, { color: v as typeof s.color })}>
                          <SelectTrigger className="h-8 w-[120px]" aria-label={`${t('tracking.admin.color')} ${s.key}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{TT_COLORS.map((c) => <SelectItem key={c} value={c}>{t(`tracking.color.${c}`)}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="p-1 text-center"><Switch checked={s.enabled} disabled={s.key === 'not_started'} onCheckedChange={(v) => setStatus(i, { enabled: v })} aria-label={`${t('tracking.admin.on')} ${s.key}`} /></td>
                      <td className="p-1 text-center"><Checkbox checked={rule.client} onCheckedChange={(v) => setRule(s.key, 'client', v === true)} aria-label={`${t('tracking.admin.client')} ${s.key}`} /></td>
                      <td className="p-1 text-center"><Checkbox checked={rule.consultant} onCheckedChange={(v) => setRule(s.key, 'consultant', v === true)} aria-label={`${t('tracking.admin.consultant')} ${s.key}`} /></td>
                      <td className="p-1 text-center">
                        <Checkbox checked={rule.note} onCheckedChange={(v) => setRule(s.key, 'note', v === true)} aria-label={`${t('tracking.admin.noteReq')} ${s.key}`} />
                        {locked && <span className="sr-only">{t('tracking.admin.locked')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('tracking.admin.adminAlways')}</p>
        </div>

        {problems.length > 0 && (
          <ul className="list-disc space-y-0.5 ps-5 text-xs text-destructive" role="alert">
            {problems.map((p) => <li key={p}>{t(`tracking.admin.p_${p.split(':')[0]}`, { key: p.split(':')[1] ?? '' })}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1 space-y-1">
            <Label htmlFor="tt-reason" className="text-xs">{t('tracking.admin.reason')}</Label>
            <Input id="tt-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button onClick={save} disabled={busy}>{busy ? t('tracking.dialog.saving') : t('tracking.admin.save')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InviteNotInstalled, inviteRpc, useInvalidateInvites, useInviteRuns, useInviteSettings, type InviteRun, type InviteSettings } from '@/hooks/useReferralInvitations';
import { INVITE_REASON_TEXT, inviteReportCsv, type InviteSkipReason } from '@/lib/referralInvitations';

/** Invitation switch (default OFF), limits, version and the example numbers used by the e-mails; plus the send history. */
export default function ReferralInviteSettingsCard() {
  const { t, i18n } = useTranslation();
  const settings = useInviteSettings();
  const runs = useInviteRuns(!(settings.error instanceof InviteNotInstalled));
  const invalidate = useInvalidateInvites();
  const [draft, setDraft] = useState<InviteSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings.data) setDraft(settings.data); }, [settings.data]);
  const reasonLabel = (r: string) => t(`rinv.r_${r}`, INVITE_REASON_TEXT[r as InviteSkipReason] ?? r);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language?.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  if (settings.error instanceof InviteNotInstalled) {
    return (
      <Card className="rounded-2xl"><CardContent className="p-4 text-sm text-muted-foreground" role="status">
        {t('rinv.settings_pending', 'The Refer & earn invitation turns on after the prepared database update (referral invitations) is applied. Until then nothing can be sent.')}
      </CardContent></Card>
    );
  }
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await inviteRpc('admin_referral_invite_set_settings', { _payload: {
        enabled: draft.enabled, max_recipients: draft.max_recipients, version: draft.version, example_fee: draft.example_fee,
        example_currency: draft.example_currency, terms_draft: draft.terms_draft } });
      toast.success(t('rinv.saved', 'Saved'));
      invalidate();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const csv = async (run: InviteRun) => {
    try {
      const r = await inviteRpc<InviteRun>('admin_referral_invite_report', { _run_id: run.id });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`\uFEFF${inviteReportCsv(r.rows ?? [], reasonLabel)}`], { type: 'text/csv;charset=utf-8' }));
      a.download = `refer-earn-invitation-${run.created_at.slice(0, 10)}.csv`;
      a.click();
    } catch (e) { toast.error((e as Error).message); }
  };
  const ro = !draft?.can_edit;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">{t('rinv.settings_title', 'Refer & earn invitation')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t('rinv.settings_intro', 'Sent from Admin › Users (selected people or all eligible consultants) as an in-app notice and Telegram, never by e-mail. Each person gets one invitation per version; resends need a reason.')}</p>
        {!draft ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
              <div><Label htmlFor="rinv-enabled" className="font-medium">{t('rinv.enabled', 'Invitations switched on')}</Label>
                <p className="text-xs text-muted-foreground">{t('rinv.enabled_hint', 'Off by default. "Send to me only" works either way.')}</p></div>
              <Switch id="rinv-enabled" checked={draft.enabled} disabled={ro} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="rinv-max">{t('rinv.max', 'Maximum recipients per request')}</Label>
                <Input id="rinv-max" type="number" min={1} max={5000} value={draft.max_recipients} disabled={ro} onChange={(e) => setDraft({ ...draft, max_recipients: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label htmlFor="rinv-ver">{t('rinv.version', 'Invitation version')}</Label>
                <Input id="rinv-ver" type="number" min={settings.data?.version ?? 1} max={1000} value={draft.version} disabled={ro} onChange={(e) => setDraft({ ...draft, version: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">{t('rinv.version_hint', 'Raise it only for a new invitation text; everyone can then receive the new version once.')}</p></div>
              <div className="space-y-1"><Label htmlFor="rinv-fee">{t('rinv.example_fee', 'Example fee in e-mails')}</Label>
                <Input id="rinv-fee" type="number" min={1} value={draft.example_fee} disabled={ro} onChange={(e) => setDraft({ ...draft, example_fee: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label htmlFor="rinv-cur">{t('rinv.example_currency', 'Example currency')}</Label>
                <Select value={draft.example_currency} disabled={ro} onValueChange={(v) => setDraft({ ...draft, example_currency: v })}>
                  <SelectTrigger id="rinv-cur"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem></SelectContent>
                </Select></div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="rinv-draft" className="font-normal">{t('rinv.terms_draft', 'Say in e-mails that the programme terms are a draft')}</Label>
              <Switch id="rinv-draft" checked={draft.terms_draft} disabled={ro} onCheckedChange={(v) => setDraft({ ...draft, terms_draft: v })} />
            </div>
            {ro ? <p className="text-xs text-muted-foreground">{t('rinv.super_only', 'Only super admins can change these settings.')}</p>
              : <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('rinv.save', 'Save settings')}</Button>}
          </>
        )}
        <div className="space-y-2">
          <h3 className="font-semibold">{t('rinv.history', 'Sent invitations')}</h3>
          {(runs.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">{t('rinv.history_empty', 'Nothing sent yet.')}</p> : (
            <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
              {(runs.data ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
                  <span>{when(r.created_at)} · v{r.version} · {r.mode === 'test' ? t('rinv.mode_test', 'test to self') : r.mode === 'all_eligible' ? t('rinv.mode_all', 'all eligible') : t('rinv.mode_selected', 'selected')}{r.resend ? ` · ${t('rinv.mode_resend', 'resend')}` : ''}{r.admin_name ? ` · ${r.admin_name}` : ''}</span>
                  <span className="tabular-nums">{t('rinv.run_counts', '{{sent}} sent · {{skipped}} skipped · {{failed}} failed', { sent: r.sent, skipped: r.skipped, failed: r.failed })}</span>
                  {r.mode !== 'test' && <Button size="sm" variant="ghost" className="h-7" onClick={() => void csv(r)}><Download className="me-1 h-3.5 w-3.5" />CSV</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

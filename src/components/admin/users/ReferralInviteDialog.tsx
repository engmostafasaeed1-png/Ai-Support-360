import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, Download, Gift, Loader2, Send, ShieldCheck, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  INVITE_REASON_TEXT, inviteBlocker, invitePayload, inviteProgress, inviteReportCsv, RESEND_REASON_MAX, type InviteSkipReason,
} from '@/lib/referralInvitations';
import { InviteNotInstalled, inviteRpc, useInvalidateInvites, useInvitePreview, useInviteReport, type InviteRun } from '@/hooks/useReferralInvitations';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

/**
 * "Send Refer & earn invitation" (Admin > Users). Shows who receives it (count, filters, 5 sample names, skip reasons),
 * channels, language handling and the message before anything goes out; the real send needs the "I confirm" tick and
 * every rule is checked again in the database. "Send to me only" always works. Never e-mailed (promotional bulk mail).
 */
export default function ReferralInviteDialog({ open, onOpenChange, mode, ids, filters }: {
  open: boolean; onOpenChange: (o: boolean) => void; mode: 'selected' | 'all_eligible'; ids: string[]; filters: Record<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidateInvites();
  const [includeTests, setIncludeTests] = useState(false);
  const [resend, setResend] = useState(false);
  const [reason, setReason] = useState('');
  const [telegram, setTelegram] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [showMsg, setShowMsg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIncludeTests(false); setResend(false); setReason(''); setConfirmed(false); setShowMsg(false); setRunId(null); setKey(newKey());
  }, [open, mode]);

  const previewPayload = useMemo(() => (open && !runId ? { mode, user_ids: mode === 'selected' ? ids : undefined, include_tests: includeTests, resend } : null),
    [open, runId, mode, ids, includeTests, resend]);
  const preview = useInvitePreview(previewPayload);
  const p = preview.data;
  const installed = !(preview.error instanceof InviteNotInstalled);
  const report = useInviteReport(runId, true);
  const progress = inviteProgress(report.data);
  const reasonLabel = (r: string) => t(`rinv.r_${r}`, INVITE_REASON_TEXT[r as InviteSkipReason] ?? r);

  const blocker = inviteBlocker({ installed, enabled: !!p?.enabled && !!p?.bulk_enabled, eligible: p?.eligible ?? 0, maxRecipients: p?.max_recipients ?? 500,
    confirmed, resend, reason, busy });
  const blockerText: Record<string, string> = {
    not_installed: t('rinv.b_not_installed', 'This waits for the prepared database update (referral invitations).'),
    switched_off: p?.bulk_enabled === false ? t('rinv.b_bulk_off', 'Bulk messages are switched off in Messages settings.') : t('rinv.b_off', 'Invitations are switched off. A super admin turns them on in Admin › Referrals › Invitation.'),
    nobody: t('rinv.b_nobody', 'Nobody in this selection can receive the invitation.'),
    too_many: t('rinv.b_too_many', 'More than {{n}} recipients. Narrow the selection.', { n: p?.max_recipients ?? 500 }),
    reason: t('rinv.b_reason', 'A resend needs a reason (at least 10 characters).'),
    confirm: t('rinv.b_confirm', 'Tick "I confirm" to enable sending.'),
  };

  const send = async (test: boolean) => {
    setBusy(true);
    try {
      const r = await inviteRpc<InviteRun>('admin_referral_invite_send', {
        _payload: invitePayload({ mode: test ? 'test' : mode, ids, includeTests, resend, reason, telegram, confirmed: test ? false : confirmed, key: test ? newKey() : key, filters }),
      });
      if (test) {
        toast.success(t('rinv.test_done', 'Test sent to your own bell only. Check it before sending.'));
      } else {
        setRunId(r.id);
        if (r.repeated) toast.message(t('rinv.repeated', 'This request was already sent - showing its result.'));
        invalidate();
      }
    } catch (e) {
      toast.error(e instanceof InviteNotInstalled ? blockerText.not_installed : (e as Error).message);
    } finally { setBusy(false); }
  };

  const downloadCsv = () => {
    const rows = report.data?.rows ?? [];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`\uFEFF${inviteReportCsv(rows, reasonLabel)}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `refer-earn-invitation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const filterList = Object.entries(filters);
  const nf = new Intl.NumberFormat(i18n.language?.startsWith('ar') ? 'ar' : 'en');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-refer-from to-refer-to text-refer-foreground" aria-hidden><Gift className="h-4 w-4" /></span>
            {t('rinv.title', 'Send Refer & earn invitation')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'all_eligible' ? t('rinv.desc_all', 'All eligible consultants. Every rule is checked again on the server before anything is sent.')
              : t('rinv.desc_selected', '{{n}} selected people. Every rule is checked again on the server before anything is sent.', { n: ids.length })}
          </DialogDescription>
        </DialogHeader>

        {runId ? (
          <section aria-live="polite" className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{progress.done ? t('rinv.done', 'Finished') : t('rinv.sending', 'Sending in small batches…')}</span>
                <span className="tabular-nums text-muted-foreground">{nf.format(progress.sent + progress.failed)} / {nf.format(progress.total)}</span>
              </div>
              <Progress value={progress.percent} aria-label={t('rinv.progress', 'Sending progress')} />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-success/10 p-2"><dt className="text-xs text-muted-foreground">{t('rinv.sent', 'Sent')}</dt><dd className="text-lg font-bold tabular-nums">{nf.format(report.data?.sent ?? 0)}</dd></div>
              <div className="rounded-xl bg-muted p-2"><dt className="text-xs text-muted-foreground">{t('rinv.skipped', 'Skipped')}</dt><dd className="text-lg font-bold tabular-nums">{nf.format(report.data?.skipped ?? 0)}</dd></div>
              <div className="rounded-xl bg-destructive/10 p-2"><dt className="text-xs text-muted-foreground">{t('rinv.failed', 'Failed')}</dt><dd className="text-lg font-bold tabular-nums">{nf.format(report.data?.failed ?? 0)}</dd></div>
            </dl>
            {Object.keys(report.data?.skipped_by_reason ?? {}).length > 0 && (
              <ul className="space-y-0.5 rounded-xl border border-border/60 p-3 text-xs">
                {Object.entries(report.data?.skipped_by_reason ?? {}).map(([k, n]) => <li key={k}>{t('rinv.skipped_n', 'Skipped {{n}}: {{why}}', { n, why: reasonLabel(k) })}</li>)}
              </ul>
            )}
            {(report.data?.rows ?? []).some((r) => r.outcome === 'failed') && (
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-destructive">
                {(report.data?.rows ?? []).filter((r) => r.outcome === 'failed').map((r) => <li key={r.user_id}><XCircle className="me-1 inline h-3 w-3" />{r.name}: {r.reason ?? t('rinv.failed', 'Failed')}</li>)}
              </ul>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={downloadCsv} disabled={!report.data?.rows?.length}><Download className="me-1 h-4 w-4" />{t('rinv.csv', 'Download report (CSV)')}</Button>
              <Button onClick={() => onOpenChange(false)}>{t('common.close', 'Close')}</Button>
            </DialogFooter>
          </section>
        ) : (
          <div className="space-y-4 text-sm">
            {preview.isLoading && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('rinv.checking', 'Checking who can receive it…')}</p>}
            {!installed && <p className="rounded-xl border border-info/30 bg-info/10 p-3" role="status">{blockerText.not_installed}</p>}
            {preview.error && installed && <p className="text-destructive" role="alert">{(preview.error as Error).message}</p>}

            {p && (
              <>
                <section aria-labelledby="rinv-who" className="space-y-2 rounded-xl border border-border/60 p-3">
                  <h3 id="rinv-who" className="font-semibold">{t('rinv.who', 'Who receives it')}</h3>
                  <p className="text-base"><strong className="tabular-nums">{nf.format(p.eligible)}</strong> {t('rinv.of_n', 'of {{n}} will receive it', { n: nf.format(p.candidates) })}{p.resends ? ` · ${t('rinv.resends_n', '{{n}} as a resend', { n: p.resends })}` : ''}</p>
                  {filterList.length > 0 && (
                    <p className="text-xs text-muted-foreground">{t('rinv.filters', 'Filters applied')}: {filterList.map(([k, v]) => `${k}=${v}`).join(' · ')}</p>
                  )}
                  {p.sample.length > 0 && <p className="text-xs"><span className="text-muted-foreground">{t('rinv.sample', 'For example')}:</span> {p.sample.join(', ')}</p>}
                  {Object.keys(p.skipped).length > 0 && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {Object.entries(p.skipped).map(([k, n]) => <li key={k}>{t('rinv.skipped_n', 'Skipped {{n}}: {{why}}', { n, why: reasonLabel(k) })}</li>)}
                    </ul>
                  )}
                  {p.announced_before > 0 && <p className="text-xs text-muted-foreground">{t('rinv.announced', '{{n}} of them already saw the launch announcement.', { n: p.announced_before })}</p>}
                </section>

                <section aria-labelledby="rinv-how" className="space-y-2 rounded-xl border border-border/60 p-3">
                  <h3 id="rinv-how" className="font-semibold">{t('rinv.channels', 'Channels and language')}</h3>
                  <ul className="space-y-1 text-xs">
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />{t('rinv.ch_inapp', 'In-app notification (bell), for everyone')}</li>
                    <li className="flex items-center gap-2">
                      <Checkbox id="rinv-tg" checked={telegram} onCheckedChange={(v) => setTelegram(!!v)} disabled={!p.telegram_linked} />
                      <Label htmlFor="rinv-tg" className="text-xs font-normal">{t('rinv.ch_telegram', 'Telegram, for the {{n}} who linked it', { n: p.telegram_linked })}</Label>
                    </li>
                    <li className="text-muted-foreground">{t('rinv.ch_email', 'Not e-mailed: an invitation to many people is promotional mail, which app e-mails must not carry. Push notifications are not used.')}</li>
                    <li className="text-muted-foreground">{t('rinv.lang', 'Each person gets their own language: {{ar}} Arabic, {{en}} English.', { ar: p.arabic, en: p.english })}</li>
                  </ul>
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" aria-expanded={showMsg} onClick={() => setShowMsg((v) => !v)}>{showMsg ? t('rinv.hide_msg', 'Hide the message') : t('rinv.show_msg', 'Preview the message')}</Button>
                  {showMsg && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-muted/50 p-2 text-xs" dir="ltr" lang="en"><p className="font-semibold">{p.message.subject_en}</p><p className="mt-1 whitespace-pre-line text-muted-foreground">{p.message.body_en}</p></div>
                      <div className="rounded-lg bg-muted/50 p-2 text-xs" dir="rtl" lang="ar"><p className="font-semibold">{p.message.subject_ar}</p><p className="mt-1 whitespace-pre-line text-muted-foreground">{p.message.body_ar}</p></div>
                    </div>
                  )}
                </section>

                <section aria-labelledby="rinv-opts" className="space-y-2">
                  <h3 id="rinv-opts" className="sr-only">{t('rinv.options', 'Options')}</h3>
                  <div className="flex items-start gap-2">
                    <Checkbox id="rinv-tests" checked={includeTests} onCheckedChange={(v) => setIncludeTests(!!v)} />
                    <Label htmlFor="rinv-tests" className="text-xs font-normal">{t('rinv.include_tests', 'Include accounts tagged "test"')}</Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox id="rinv-resend" checked={resend} onCheckedChange={(v) => setResend(!!v)} />
                    <Label htmlFor="rinv-resend" className="text-xs font-normal">{t('rinv.resend', 'Resend to people already invited (at most once every {{d}} days, reason required)', { d: p.resend_days })}</Label>
                  </div>
                  {resend && (
                    <div className="space-y-1">
                      <Label htmlFor="rinv-reason" className="text-xs">{t('rinv.reason', 'Reason for the resend')}</Label>
                      <Textarea id="rinv-reason" value={reason} maxLength={RESEND_REASON_MAX} onChange={(e) => setReason(e.target.value)} rows={2} />
                    </div>
                  )}
                </section>

                <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <Checkbox id="rinv-confirm" checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} aria-describedby="rinv-confirm-hint" />
                  <div>
                    <Label htmlFor="rinv-confirm" className="font-medium">{t('rinv.confirm', 'I confirm')}</Label>
                    <p id="rinv-confirm-hint" className="text-xs text-muted-foreground">{t('rinv.confirm_hint', 'I checked the recipients, channels and message. Sending cannot be undone.')}</p>
                  </div>
                </div>
                {blocker && blocker !== 'busy' && <p className="text-xs text-muted-foreground" role="status">{blockerText[blocker]}</p>}
              </>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => void send(true)} disabled={busy || !installed}><ShieldCheck className="me-1 h-4 w-4" />{t('rinv.test', 'Send to me only')}</Button>
              <Button onClick={() => void send(false)} disabled={!!blocker} className="gap-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:rotate-180" />}
                {t('rinv.send_n', 'Send to {{n}}', { n: nf.format(p?.eligible ?? 0) })}
              </Button>
            </DialogFooter>
            {p && <p className="text-[11px] text-muted-foreground"><Badge variant="outline" className="me-1 text-[10px]">v{p.version}</Badge>{t('rinv.limits', 'At most {{max}} per request · {{used}} of {{cap}} messages used today', { max: p.max_recipients, used: p.sent_today, cap: p.daily_cap })}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

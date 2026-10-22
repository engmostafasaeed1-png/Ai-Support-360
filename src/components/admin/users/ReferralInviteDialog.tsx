import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Gift, Loader2, Send, ShieldCheck, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import SendViaSelector from '@/components/admin/SendViaSelector';
import NoticeTextBlocks from '@/components/notifications/NoticeTextBlocks';
import { ReferralNoticeIcon } from '@/components/notifications/ReferralNotice';
import {
  INVITE_REASON_TEXT, inviteBlocker, inviteChannelInfo, inviteChannelReport, invitePayload, inviteProgress, inviteReach, inviteReportCsv,
  RESEND_REASON_MAX, rowChannels, type InviteSkipReason,
} from '@/lib/referralInvitations';
import { CHANNEL_REASON_TEXT, defaultSelection, pushPreview, SEND_CHANNELS, type SendChannel } from '@/lib/sendChannels';
import { cleanNoticeText } from '@/lib/noticeText';
import { referralNoticeView } from '@/lib/referralNotice';
import { footerText, toPlainText } from '@/lib/bulkMessaging';
import { InviteNotInstalled, inviteRpc, useInvalidateInvites, useInvitePreview, useInviteReport, type InvitePreview, type InviteRun } from '@/hooks/useReferralInvitations';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);
const CH_EN: Record<SendChannel, string> = { in_app: 'In-app', email: 'E-mail', push: 'Push', telegram: 'Telegram' };

/**
 * "Send Refer & earn invitation" (Admin > Users). Shows who receives it (count, filters, 5 sample names, skip reasons),
 * "Send via" channels with the number reached per channel, language handling and a preview per channel before anything
 * goes out; the real send needs the "I confirm" tick and the database checks every rule again, per person and channel.
 * "Send to me only" always works and reaches only the signed-in admin.
 */
export default function ReferralInviteDialog({ open, onOpenChange, mode, ids, filters }: {
  open: boolean; onOpenChange: (o: boolean) => void; mode: 'selected' | 'all_eligible'; ids: string[]; filters: Record<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidateInvites();
  const [includeTests, setIncludeTests] = useState(false);
  const [resend, setResend] = useState(false);
  const [reason, setReason] = useState('');
  const [channels, setChannels] = useState<SendChannel[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIncludeTests(false); setResend(false); setReason(''); setConfirmed(false); setRunId(null); setKey(newKey()); setChannels(null);
  }, [open, mode]);

  const previewPayload = useMemo(() => (open && !runId ? { mode, user_ids: mode === 'selected' ? ids : undefined, include_tests: includeTests, resend } : null),
    [open, runId, mode, ids, includeTests, resend]);
  const preview = useInvitePreview(previewPayload);
  const p = preview.data;
  const installed = !(preview.error instanceof InviteNotInstalled);
  const info = useMemo(() => inviteChannelInfo(p), [p]);
  // Default In-app + E-mail (recommended); unavailable channels are never selected silently.
  const selected = channels ?? defaultSelection(info);
  const reach = inviteReach(p, selected, p?.reach);
  const report = useInviteReport(runId, true);
  const progress = inviteProgress(report.data);
  const reasonLabel = (r: string) => t(`rinv.r_${r}`, INVITE_REASON_TEXT[r as InviteSkipReason] ?? t(`chan.r_${r}`, CHANNEL_REASON_TEXT[r as keyof typeof CHANNEL_REASON_TEXT] ?? r));

  const blocker = selected.length === 0 ? 'channels' : inviteBlocker({ installed, enabled: !!p?.enabled && !!p?.bulk_enabled, eligible: reach, maxRecipients: p?.max_recipients ?? 500,
    confirmed, resend, reason, busy });
  const blockerText: Record<string, string> = {
    not_installed: t('rinv.b_not_installed', 'This waits for the prepared database update (referral invitations).'),
    switched_off: p?.bulk_enabled === false ? t('rinv.b_bulk_off', 'Bulk messages are switched off in Messages settings.') : t('rinv.b_off', 'Invitations are switched off. A super admin turns them on in Admin › Referrals › Invitation.'),
    nobody: t('rinv.b_nobody', 'Nobody in this selection can receive the invitation.'),
    too_many: t('rinv.b_too_many', 'More than {{n}} recipients. Narrow the selection.', { n: p?.max_recipients ?? 500 }),
    reason: t('rinv.b_reason', 'A resend needs a reason (at least 10 characters).'),
    confirm: t('rinv.b_confirm', 'Tick "I confirm" to enable sending.'),
    channels: t('chan.none', 'Choose at least one channel.'),
  };

  const sendTest = async () => {
    setBusy(true);
    const lines: string[] = [];
    try {
      if (selected.includes('in_app')) {
        await inviteRpc<InviteRun>('admin_referral_invite_send', {
          _payload: invitePayload({ mode: 'test', ids, channels: ['in_app'], key: newKey(), filters }),
        });
        lines.push(`${t('chan.c_in_app', 'In-app notification')}: ${t('rinv.test_sent', 'sent to your bell')}`);
      }
      const other = selected.filter((c) => c === 'push' || c === 'telegram');
      if (other.length) {
        const { data, error } = await supabase.functions.invoke('referral-invite-test', { body: { channels: other } });
        if (error) throw new Error(t('rinv.test_fn_failed', 'The push / Telegram test could not be sent. Please try again.'));
        for (const r of ((data as { results?: Array<{ channel: SendChannel; status: string; reason?: string }> })?.results ?? [])) {
          lines.push(`${t(`chan.c_${r.channel}`, CH_EN[r.channel])}: ${r.status === 'sent' ? t('rinv.test_sent_you', 'sent to you') : reasonLabel(r.reason ?? 'failed')}`);
        }
      }
      if (selected.includes('email')) lines.push(`${t('chan.c_email', 'E-mail')}: ${reasonLabel('email_not_allowed')}`);
      toast.success(t('rinv.test_done_title', 'Test sent to you only'), { description: lines.join('\n') });
    } catch (e) {
      toast.error(e instanceof InviteNotInstalled ? blockerText.not_installed : (e as Error).message);
    } finally { setBusy(false); }
  };

  const send = async () => {
    setBusy(true);
    try {
      const r = await inviteRpc<InviteRun>('admin_referral_invite_send', {
        _payload: invitePayload({ mode, ids, includeTests, resend, reason, channels: selected, confirmed, key, filters }),
      });
      setRunId(r.id);
      if (r.repeated) toast.message(t('rinv.repeated', 'This request was already sent - showing its result.'));
      invalidate();
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
  const byChannel = inviteChannelReport(report.data);

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
            {Object.keys(byChannel).length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full text-xs" aria-label={t('chan.report', 'Result per channel')}>
                  <thead className="bg-muted/50 text-muted-foreground"><tr>
                    <th scope="col" className="p-2 text-start">{t('chan.channel', 'Channel')}</th>
                    <th scope="col" className="p-2 text-end">{t('rinv.sent', 'Sent')}</th>
                    <th scope="col" className="p-2 text-end">{t('rinv.failed', 'Failed')}</th>
                    <th scope="col" className="p-2 text-start">{t('rinv.skipped', 'Skipped')}</th>
                  </tr></thead>
                  <tbody>
                    {SEND_CHANNELS.filter((c) => byChannel[c]).map((c) => {
                      const r = byChannel[c]!;
                      const skipped = Object.entries(r.skipped);
                      return (
                        <tr key={c} className="border-t border-border/60">
                          <th scope="row" className="p-2 text-start font-medium">{t(`chan.c_${c}`, CH_EN[c])}{r.sending > 0 && <span className="ms-1 font-normal text-muted-foreground">({t('chan.sending_n', '{{n}} sending', { n: nf.format(r.sending) })})</span>}</th>
                          <td className="p-2 text-end tabular-nums">{nf.format(r.sent)}</td>
                          <td className="p-2 text-end tabular-nums">{nf.format(r.failed)}</td>
                          <td className="p-2">{skipped.length ? skipped.map(([k, n]) => `${nf.format(n)} · ${reasonLabel(k)}`).join('; ') : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {Object.keys(report.data?.skipped_by_reason ?? {}).length > 0 && (
              <ul className="space-y-0.5 rounded-xl border border-border/60 p-3 text-xs">
                {Object.entries(report.data?.skipped_by_reason ?? {}).map(([k, n]) => <li key={k}>{t('rinv.skipped_n', 'Skipped {{n}}: {{why}}', { n, why: reasonLabel(k) })}</li>)}
              </ul>
            )}
            {(report.data?.rows ?? []).some((r) => r.outcome === 'failed' || Object.values(rowChannels(r)).some((c) => c?.status === 'failed')) && (
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-destructive">
                {(report.data?.rows ?? []).flatMap((r) => Object.entries(rowChannels(r)).filter(([, c]) => c?.status === 'failed')
                  .map(([ch, c]) => <li key={`${r.user_id}-${ch}`}><XCircle className="me-1 inline h-3 w-3" />{r.name} · {t(`chan.c_${ch}`, CH_EN[ch as SendChannel])}: {c?.reason ?? t('rinv.failed', 'Failed')}</li>))}
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
                  <p className="text-base"><strong className="tabular-nums">{nf.format(reach)}</strong> {t('rinv.of_n', 'of {{n}} will receive it', { n: nf.format(p.candidates) })}{p.resends ? ` · ${t('rinv.resends_n', '{{n}} as a resend', { n: p.resends })}` : ''}</p>
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

                <section aria-labelledby="rinv-how" className="space-y-3 rounded-xl border border-border/60 p-3">
                  <h3 id="rinv-how" className="sr-only">{t('rinv.channels', 'Channels and language')}</h3>
                  <SendViaSelector idPrefix="rinv" value={selected} onChange={setChannels} info={info} />
                  <p className="text-xs text-muted-foreground">{t('rinv.lang', 'Each person gets their own language: {{ar}} Arabic, {{en}} English.', { ar: p.arabic, en: p.english })}</p>
                  <ChannelPreviews p={p} />
                </section>

                <section aria-labelledby="rinv-opts" className="space-y-2">
                  <h3 id="rinv-opts" className="sr-only">{t('rinv.options', 'Options')}</h3>
                  <div className="flex items-start gap-2">
                    <Checkbox id="rinv-tests" checked={includeTests} onCheckedChange={(v) => setIncludeTests(!!v)} />
                    <Label htmlFor="rinv-tests" className="text-xs font-normal">{t('rinv.include_tests', 'Include accounts tagged "test"')}</Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox id="rinv-resend" checked={resend} onCheckedChange={(v) => setResend(!!v)} />
                    <Label htmlFor="rinv-resend" className="text-xs font-normal">{t('rinv.resend_ch', 'Resend on the chosen channels to people already invited there (at most once every {{d}} days per channel, reason required)', { d: p.resend_days })}</Label>
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
              <Button variant="outline" onClick={() => void sendTest()} disabled={busy || !installed || selected.length === 0}><ShieldCheck className="me-1 h-4 w-4" />{t('rinv.test', 'Send to me only')}</Button>
              <Button onClick={() => void send()} disabled={!!blocker} className="gap-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:rotate-180" />}
                {t('rinv.send_n', 'Send to {{n}}', { n: nf.format(reach) })}
              </Button>
            </DialogFooter>
            {p && <p className="text-[11px] text-muted-foreground"><Badge variant="outline" className="me-1 text-[10px]">v{p.version}</Badge>{t('rinv.limits', 'At most {{max}} per request · {{used}} of {{cap}} messages used today', { max: p.max_recipients, used: p.sent_today, cap: p.daily_cap })}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What each channel will look like, in English and Arabic (the same text the server stores and sends). */
function ChannelPreviews({ p }: { p: InvitePreview }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const subject = lang === 'ar' ? p.message.subject_ar : p.message.subject_en;
  const body = cleanNoticeText(lang === 'ar' ? p.message.body_ar : p.message.body_en, { firstName: lang === 'ar' ? 'سارة' : 'Sara' });
  const plain = toPlainText(body.replace(/\{\{\s*link\s*\}\}/g, 'https://www.aisupport360.com/consultant/referrals'));
  const push = pushPreview(subject, plain);
  const view = referralNoticeView({ type: 'referral', title: subject, link: p.message.link_url });
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return (
    <details className="rounded-lg border border-border/60 p-2">
      <summary className="cursor-pointer text-xs font-medium text-primary">{t('chan.preview', 'Preview per channel')}</summary>
      <div className="mt-2 space-y-2">
        <div role="group" aria-label={t('chan.preview_lang', 'Preview language')} className="flex gap-1">
          {(['en', 'ar'] as const).map((l) => (
            <Button key={l} type="button" size="sm" variant={lang === l ? 'default' : 'outline'} className="h-7 px-2 text-xs" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'en' ? 'English' : 'العربية'}</Button>
          ))}
        </div>
        <Tabs defaultValue="in_app">
          <TabsList className="h-auto flex-wrap">
            {SEND_CHANNELS.map((c) => <TabsTrigger key={c} value={c} className="text-xs">{t(`chan.c_${c}`, CH_EN[c])}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="in_app">
            <div className="flex gap-3 rounded-xl border border-border/60 bg-card p-3" dir={dir} lang={lang}>
              <ReferralNoticeIcon view={view} />
              <div className="min-w-0"><p className="text-sm font-semibold">{subject}</p><NoticeTextBlocks text={body} className="mt-1 text-xs" /></div>
            </div>
          </TabsContent>
          <TabsContent value="email">
            <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">{t('chan.email_invite_note', 'The invitation is not e-mailed: an invitation to many people is promotional mail, which the app e-mail service must not carry. It needs a separate marketing e-mail service. The referral event e-mails (reward earned, paid...) can be previewed in Admin › Referrals › E-mails.')}</p>
          </TabsContent>
          <TabsContent value="push">
            <div className="max-w-sm rounded-2xl border border-border/60 bg-muted/40 p-3 shadow-sm" dir={dir} lang={lang}>
              <p className="text-[11px] text-muted-foreground">AI Support 360</p>
              <p className="text-sm font-semibold">{push.title}</p>
              <p className="text-xs text-muted-foreground">{push.body}</p>
            </div>
          </TabsContent>
          <TabsContent value="telegram">
            <div className="max-w-sm whitespace-pre-line rounded-2xl rounded-ss-sm bg-info/10 p-3 text-xs" dir={dir} lang={lang}>
              <p className="font-semibold">{subject}</p>
              <p className="mt-1">{plain}</p>
              <p className="mt-2 text-muted-foreground">{footerText(lang, 'marketing')}</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </details>
  );
}

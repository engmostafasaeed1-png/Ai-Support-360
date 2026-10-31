import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Mail, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import AdminMessageComposer from '@/components/admin/AdminMessageComposer';
import DirectEmailReport from '@/components/admin/DirectEmailReport';
import { callRpc, NotInstalledError } from '@/hooks/useUserAdmin';
import {
  directBlocker, directPayload, newRequestKey, REASON_TEXT, type DirectContent, type DirectOptions, type DirectPreview, type DirectReport,
} from '@/lib/adminDirectEmail';

/** Server error codes of admin_direct_email_send → readable text (the database checks every rule again). */
const ERR_EN: Record<string, string> = {
  ade_switched_off: 'Direct admin e-mail is switched off in Admin › Settings.',
  ade_email_off: 'Admin e-mails are switched off in Admin › Settings. Choose "In-app only" or switch e-mails on.',
  ade_over_cap: 'More people than the limit per send. Narrow the selection.',
  ade_nobody: 'Nobody in this selection can receive it.',
  ade_outside_link: 'Web addresses in the message must be pages on aisupport360.com.',
  ade_arabic_incomplete: 'Write both the Arabic subject and message, or leave both empty.',
  ame_secret: 'The message looks like it contains a password or secret key. Remove it first.',
  ame_link: 'The button must open a page on this site (starting with /).',
  ame_lengths: 'A field is too long.',
  ame_deadline: 'The deadline must be today or within a year.',
  ade_confirm: 'Tick "I confirm" first.',
};

/**
 * "Send e-mail" (Admin › Users): one person, the selected people, or everyone in the current filter. Step 1 the shared
 * compose box (channel, Arabic version, preview, "Send test to me"); step 2 the confirmation with the count, the list,
 * who is left out and why, and the limits; step 3 the result per person. Sends through admin_direct_email_send
 * (docs/sql/admin-direct-email.sql): one message per person, never a shared list.
 */
export default function DirectEmailDialog({ open, onOpenChange, ids, label, sampleName, note }: {
  open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; label: string; sampleName?: string; note?: string;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<'compose' | 'confirm' | 'result'>('compose');
  const [draft, setDraft] = useState<{ content: DirectContent; opts: DirectOptions } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newRequestKey);
  const [result, setResult] = useState<DirectReport | null>(null);
  const [composerKey, setComposerKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep('compose'); setDraft(null); setConfirmed(false); setResult(null); setKey(newRequestKey()); setComposerKey((k) => k + 1);
  }, [open]);

  const preview = useQuery({
    queryKey: ['ade-preview', ids, draft?.opts, draft?.content.category], enabled: open && step === 'confirm' && !!draft, retry: false,
    queryFn: () => callRpc<DirectPreview>('admin_direct_email_preview', {
      _p: { ids, channel: draft!.opts.channel, important: draft!.opts.important, tests: draft!.opts.includeTests, category: draft!.content.category },
    }),
  });
  const installed = !(preview.error instanceof NotInstalledError);
  const p = preview.data;
  const blocker = directBlocker(p, { installed, confirmed });
  const nf = new Intl.NumberFormat(i18n.language?.startsWith('ar') ? 'ar' : 'en');
  const reason = (r: string) => t(`ade.r_${r}`, REASON_TEXT[r] ?? r);
  const errText = (e: unknown) => {
    if (e instanceof NotInstalledError) return t('ade.not_ready', 'Direct e-mail starts once the prepared database update (admin direct e-mail) is applied.');
    const m = (e as Error).message ?? '';
    const code = Object.keys(ERR_EN).find((k) => m.includes(k));
    return code ? t(`ade.e_${code}`, ERR_EN[code]) : m;
  };
  const blockerText: Record<string, string> = {
    not_installed: t('ade.not_ready', 'Direct e-mail starts once the prepared database update (admin direct e-mail) is applied.'),
    switched_off: t('ade.e_ade_switched_off', ERR_EN.ade_switched_off),
    email_off: t('ade.e_ade_email_off', ERR_EN.ade_email_off),
    nobody: t('ade.e_ade_nobody', ERR_EN.ade_nobody),
    over_cap: t('ade.b_over_cap', '{{n}} people, the limit per send is {{max}}. Narrow the selection.', { n: p?.recipients ?? 0, max: p?.cap ?? 200 }),
    confirm: t('ade.b_confirm', 'Tick "I confirm" to enable sending.'),
  };

  async function sendTest(content: DirectContent, opts: DirectOptions) {
    try {
      await callRpc('admin_direct_email_send', { _p: directPayload(content, opts, [], { test: true }) });
      toast.success(t('ade.test_sent', 'Test sent to you only.'));
    } catch (e) { toast.error(errText(e)); }
  }

  async function send() {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await callRpc<DirectReport>('admin_direct_email_send', { _p: directPayload(draft.content, draft.opts, ids, { requestKey: key, confirmed: true }) });
      setResult(r); setStep('result');
      if (r.repeated) toast.message(t('ade.repeated', 'This request was already sent - showing its result.'));
      qc.invalidateQueries({ queryKey: ['ade-sends'] });
      qc.invalidateQueries({ queryKey: ['admin-message-history'] });
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-6xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" aria-hidden />{t('ade.title', 'Send e-mail')}</DialogTitle>
          <DialogDescription>
            {step === 'compose' && t('ade.step_compose', 'Step 1 of 3 · Write the message. Each person gets their own copy in their language.')}
            {step === 'confirm' && t('ade.step_confirm', 'Step 2 of 3 · Check who receives it.')}
            {step === 'result' && t('ade.step_result', 'Step 3 of 3 · Result per person.')}
            {note && <span className="block text-xs">{note}</span>}
          </DialogDescription>
        </DialogHeader>

        {/* The compose box stays mounted (hidden) during the confirmation so "Back" keeps every field. */}
        <div hidden={step !== 'compose'}>
          <AdminMessageComposer key={composerKey} recipient={{ id: '', name: label }} onSent={() => undefined} onCancel={() => onOpenChange(false)}
            direct={{ count: ids.length, sampleName, onTest: sendTest, onReview: (content, opts) => { setDraft({ content, opts }); setConfirmed(false); setStep('confirm'); } }} />
        </div>

        {step === 'confirm' && (
          <div className="space-y-4 text-sm">
            {preview.isLoading && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('ade.checking', 'Checking who can receive it…')}</p>}
            {preview.error && <p className={installed ? 'text-destructive' : 'rounded-xl border border-info/30 bg-info/10 p-3'} role={installed ? 'alert' : 'status'}>{errText(preview.error)}</p>}
            {p && (
              <>
                <section aria-labelledby="ade-who" className="space-y-2 rounded-xl border border-border/60 p-3">
                  <h3 id="ade-who" className="font-semibold">{t('ade.who', 'Who receives it')}</h3>
                  <p className="text-base">
                    <strong className="tabular-nums">{nf.format(p.recipients)}</strong> {t('ade.of_n', 'of {{n}} selected', { n: nf.format(p.requested) })}
                    {p.channel !== 'in_app' && <> · {t('ade.emails_n', '{{n}} e-mails', { n: nf.format(p.email_reach) })}</>}
                    {p.channel !== 'email' && <> · {t('ade.in_app_n', '{{n}} in-app', { n: nf.format(p.in_app_reach) })}</>}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('ade.lang_split', 'Each person in their language: {{ar}} Arabic, {{en}} English.', { ar: p.arabic, en: p.english })}</p>
                  {p.sample.length > 0 && (
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-muted/40 p-2 text-xs" aria-label={t('ade.list_preview', 'Recipients (preview)')}>
                      {p.sample.map((s) => <li key={s.id} className="flex justify-between gap-2"><span className="truncate">{s.name || '—'}</span><span className="truncate text-muted-foreground" dir="ltr">{s.email}</span></li>)}
                      {p.recipients > p.sample.length && <li className="text-muted-foreground">{t('ade.and_more', '…and {{n}} more', { n: nf.format(p.recipients - p.sample.length) })}</li>}
                    </ul>
                  )}
                </section>

                {p.excluded.length > 0 && (
                  <section aria-labelledby="ade-left" className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                    <h3 id="ade-left" className="font-semibold">{t('ade.left_out', 'Left out')}</h3>
                    <ul className="space-y-0.5 text-xs">
                      {Object.entries(p.by_reason).map(([k, n]) => <li key={k}>{t('ade.left_out_n', '{{n}}: {{why}}', { n, why: reason(k) })}</li>)}
                    </ul>
                    {p.channel === 'both' && p.excluded.some((e) => e.scope === 'email') && <p className="text-xs text-muted-foreground">{t('ade.email_only_left', 'People left out of the e-mail still get the in-app notice.')}</p>}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-primary">{t('ade.show_names', 'Show names')}</summary>
                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                        {p.excluded.map((e) => <li key={e.id}>{e.name || e.email || e.id.slice(0, 8)} · <span className="text-muted-foreground">{reason(e.reason)}</span></li>)}
                      </ul>
                    </details>
                  </section>
                )}

                <p className="text-xs text-muted-foreground">
                  {t('ade.limits', 'At most {{cap}} people per send · {{used}} of {{daily}} e-mails used today · {{hour}} per hour per admin.', { cap: p.cap, used: p.sent_today, daily: p.daily_cap, hour: p.per_admin_hour })}
                  {p.later > 0 && <> {t('ade.later', 'About {{n}} e-mails wait in the queue and go out later; the result shows when each one leaves.', { n: nf.format(p.later) })}</>}
                </p>

                <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <Checkbox id="ade-confirm" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} aria-describedby="ade-confirm-hint" />
                  <div>
                    <Label htmlFor="ade-confirm" className="font-medium">{t('rinv.confirm', 'I confirm')}</Label>
                    <p id="ade-confirm-hint" className="text-xs text-muted-foreground">{t('ade.confirm_hint', 'I checked the people, the channel and the message. Sending cannot be undone.')}</p>
                  </div>
                </div>
              </>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setStep('compose')} reason={busy && 'action_in_progress'}><ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />{t('ade.back', 'Back to the message')}</Button>
              <Button onClick={() => void send()} busy={busy} hint="inline"
                reason={blocker && { key: blocker === 'not_installed' ? 'feature_not_ready' : blocker === 'switched_off' || blocker === 'email_off' ? 'feature_disabled_by_admin' : blocker === 'nobody' ? 'no_recipients' : blocker === 'over_cap' ? 'too_many_recipients' : 'tick_confirmation_first', params: { max: p?.cap ?? 200 }, message: blockerText[blocker] }}>
                <Send className="me-1 h-4 w-4 rtl:rotate-180" />{t('ade.send_n', 'Send to {{n}}', { n: nf.format(p?.recipients ?? 0) })}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'result' && result && (
          <>
            <DirectEmailReport sendId={result.send.id} initial={result} />
            <DialogFooter><Button onClick={() => onOpenChange(false)}>{t('common.close', 'Close')}</Button></DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

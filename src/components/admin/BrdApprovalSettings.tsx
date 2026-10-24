import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Eye, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminBrdApprovalOverview, sendBrdApprovalTestEmail } from '@/lib/brd/approvalApi';
import { BRD_APPROVAL_EMAIL_KINDS, renderBrdApprovalEmail, sampleBrdApprovalEmail, type BrdApprovalEmailKind } from '../../../supabase/functions/_shared/brdApprovalEmail';

export const APPROVAL_NUMBERS = ['approval_remind_days', 'approval_client_days', 'approval_escalate_days', 'approval_max_reminders', 'approval_decisions_per_hour'] as const;
export const APPROVAL_SWITCHES = ['approval_all_members', 'approval_allow_no_change', 'approval_email'] as const;

/** Approval part of the BRD settings: gate mode, who must approve, carry-over, reminder timings, counts, e-mail previews. */
export default function BrdApprovalSettings({ draft, setDraft, onReady }: {
  draft: Record<string, any>; setDraft: (d: Record<string, any>) => void; onReady: (ready: boolean) => void;
}) {
  const { t } = useTranslation();
  const [ov, setOv] = useState<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<{ kind: BrdApprovalEmailKind; lang: 'en' | 'ar' } | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    void adminBrdApprovalOverview().then((r) => { const ok = !r.error && !!r.data; setReady(ok); onReady(ok); if (ok) setOv(r.data); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const html = useMemo(() => (preview ? renderBrdApprovalEmail({ ...sampleBrdApprovalEmail(preview.kind, preview.lang), test: true }).html : ''), [preview]);

  if (!ready) return <p className="text-xs text-muted-foreground">{t('brd.approval.admin.notReady')}</p>;
  return (
    <div className="space-y-4 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">{t('brd.approval.admin.title')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="brd-appr-gate" className="text-xs">{t('brd.approval.admin.gate')}</Label>
          <Select value={draft.approval_gate ?? 'recommended'} onValueChange={(v) => setDraft({ ...draft, approval_gate: v })}>
            <SelectTrigger id="brd-appr-gate"><SelectValue /></SelectTrigger>
            <SelectContent>{(['off', 'recommended', 'required'] as const).map((m) => <SelectItem key={m} value={m}>{t(`brd.approval.mode.${m}`)}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t(`brd.approval.modeHint.${draft.approval_gate ?? 'recommended'}`)}</p>
        </div>
        <div className="space-y-2">
          {APPROVAL_SWITCHES.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <Label htmlFor={`brd-${k}`} className="text-xs">{t(`brd.approval.admin.${k}`)}</Label>
              <Switch id={`brd-${k}`} checked={k === 'approval_email' ? draft[k] !== false : !!draft[k]} onCheckedChange={(v) => setDraft({ ...draft, [k]: v })} />
            </div>
          ))}
        </div>
        {APPROVAL_NUMBERS.map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`brd-${k}`} className="text-xs">{t(`brd.approval.admin.${k}`)}</Label>
            <Input id={`brd-${k}`} type="number" min={k === 'approval_max_reminders' ? 0 : 1} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      {ov && <p className="text-xs text-muted-foreground">{t('brd.approval.admin.counts', ov)}</p>}
      <div className="space-y-2">
        <p className="text-xs font-semibold">{t('brd.approval.admin.emails')}</p>
        <div className="flex flex-wrap gap-1.5">
          {BRD_APPROVAL_EMAIL_KINDS.map((k) => (
            <Button key={k} size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setPreview({ kind: k, lang: 'en' })}>
              <Eye className="h-3 w-3" /> {t(`brd.approval.email.${k}`)}
            </Button>
          ))}
        </div>
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{preview ? t(`brd.approval.email.${preview.kind}`) : ''}</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={preview.lang === 'en' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setPreview({ ...preview, lang: 'en' })}>English</Button>
                <Button size="sm" variant={preview.lang === 'ar' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setPreview({ ...preview, lang: 'ar' })}>العربية</Button>
                <Button size="sm" variant="outline" className="ms-auto h-7 gap-1 text-xs" disabled={sending} onClick={async () => {
                  setSending(true);
                  const r = await sendBrdApprovalTestEmail(preview.kind, preview.lang);
                  setSending(false);
                  if (r.ok) toast.success(t('brd.approval.admin.testSent')); else toast.error(t('brd.approval.admin.testFailed', { reason: r.error ?? '' }));
                }}><Mail className="h-3 w-3" /> {t('brd.approval.admin.sendTest')}</Button>
              </div>
              <iframe title={t('brd.approval.admin.previewTitle')} srcDoc={html} sandbox="" className="h-[60vh] w-full rounded-xl border border-border bg-background" />
              <p className="text-[11px] text-muted-foreground">{t('brd.approval.admin.previewNote')}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

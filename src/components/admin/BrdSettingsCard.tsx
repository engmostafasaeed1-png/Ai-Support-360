import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { adminBrdOverview, adminBrdSetSettings } from '@/lib/brd/api';
import BrdApprovalSettings, { APPROVAL_NUMBERS, APPROVAL_SWITCHES } from './BrdApprovalSettings';

const NUMBERS = ['ai_calls_per_ticket_per_day', 'ai_calls_per_client_per_day', 'deep_calls_per_ticket_per_day', 'max_attachments', 'max_attachment_chars', 'comments_per_user_per_day'] as const;

/** Admin switch "BRD feature enabled" (default off), NDA rule, AI limits and models, usage of the last 30 days. */
export default function BrdSettingsCard() {
  const { t } = useTranslation();
  const [ov, setOv] = useState<Record<string, any> | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [approvalReady, setApprovalReady] = useState(false);

  const load = async () => {
    const r = await adminBrdOverview();
    if (r.error) { setNotReady(!!r.notReady); return; }
    setOv(r.data); setDraft(r.data?.settings ?? {});
  };
  useEffect(() => { void load(); }, []);

  const saveAll = async () => {
    setBusy(true);
    const value: Record<string, unknown> = { enabled: !!draft.enabled, require_nda: draft.require_nda !== false, draft_model: draft.draft_model, deep_model: draft.deep_model };
    for (const k of NUMBERS) value[k] = Math.max(0, Math.floor(Number(draft[k]) || 0));
    // Approval keys only once docs/sql/ticket-brd-approval.sql is applied (older settings rules refuse unknown keys).
    if (approvalReady) {
      value.approval_gate = ['off', 'recommended', 'required'].includes(draft.approval_gate) ? draft.approval_gate : 'recommended';
      for (const k of APPROVAL_SWITCHES) value[k] = k === 'approval_email' ? draft[k] !== false : !!draft[k];
      for (const k of APPROVAL_NUMBERS) value[k] = Math.max(k === 'approval_max_reminders' ? 0 : 1, Math.floor(Number(draft[k]) || 0));
    }
    const r = await adminBrdSetSettings(value);
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    toast.success(t('brd.admin.saved'));
    void load();
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> {t('brd.admin.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {notReady || !ov ? <p className="text-sm text-muted-foreground">{notReady ? t('brd.unavailable.notReady') : t('brd.loading')}</p> : (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="brd-enabled" className="text-sm">{t('brd.admin.enabled')}</Label>
              <Switch id="brd-enabled" checked={!!draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="brd-nda" className="text-sm">{t('brd.admin.requireNda')}</Label>
              <Switch id="brd-nda" checked={draft.require_nda !== false} onCheckedChange={(v) => setDraft({ ...draft, require_nda: v })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {NUMBERS.map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`brd-${k}`} className="text-xs">{t(`brd.admin.${k}`)}</Label>
                  <Input id={`brd-${k}`} type="number" min={0} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                </div>
              ))}
              {(['draft_model', 'deep_model'] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`brd-${k}`} className="text-xs">{t(`brd.admin.${k}`)}</Label>
                  <Input id={`brd-${k}`} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <BrdApprovalSettings draft={draft} setDraft={setDraft} onReady={setApprovalReady} />
            <p className="text-xs text-muted-foreground">{t('brd.admin.usage', {
              docs: ov.documents ?? 0, versions: ov.versions ?? 0, attached: ov.attached ?? 0, today: ov.ai_today ?? 0, refused: ov.ai_refused_today ?? 0,
              tin: ov.tokens_30d?.input ?? 0, tout: ov.tokens_30d?.output ?? 0,
            })}</p>
            <Button onClick={saveAll} disabled={busy}>{t('brd.admin.save')}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Cpu } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { adminArchOverview, adminArchSetSettings } from '@/lib/architecture/api';

const NUMBERS = ['ai_calls_per_doc_per_day', 'ai_calls_per_org_per_day', 'max_brd_chars', 'docs_per_user_per_day', 'comments_per_user_per_day',
  'uploads_per_user_per_day', 'landscape_saves_per_user_per_day', 'max_assets_per_doc', 'max_versions_per_doc', 'max_systems'] as const;

/** Admin switches for Solution Architecture (feature and AI both OFF by default), NDA rule, limits, usage. */
export default function ArchSettingsCard() {
  const { t } = useTranslation();
  const [ov, setOv] = useState<Record<string, any> | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const r = await adminArchOverview();
    if (r.error) { setNotReady(true); return; }
    setOv(r.data); setDraft(r.data?.settings ?? {});
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    setBusy(true);
    const value: Record<string, unknown> = { enabled: !!draft.enabled, ai_enabled: !!draft.ai_enabled, require_nda: draft.require_nda !== false, ai_model: draft.ai_model };
    for (const k of NUMBERS) value[k] = Math.max(0, Math.floor(Number(draft[k]) || 0));
    const r = await adminArchSetSettings(value);
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    toast.success(t('arch.admin.saved'));
    void load();
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Cpu className="h-4 w-4" aria-hidden />{t('arch.admin.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {notReady || !ov ? <p className="text-sm text-muted-foreground">{notReady ? t('arch.unavailable.notReady') : t('arch.loading')}</p> : (
          <>
            {(['enabled', 'ai_enabled', 'require_nda'] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <Label htmlFor={`arch-${k}`} className="text-sm">{t(`arch.admin.${k}`)}</Label>
                <Switch id={`arch-${k}`} checked={k === 'require_nda' ? draft[k] !== false : !!draft[k]} disabled={k === 'ai_enabled' && !draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, [k]: v })} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t('arch.admin.offNote')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {NUMBERS.map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`arch-n-${k}`} className="text-xs">{t(`arch.admin.${k}`)}</Label>
                  <Input id={`arch-n-${k}`} type="number" min={0} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                </div>
              ))}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="arch-model" className="text-xs">{t('arch.admin.ai_model')}</Label>
                <Input id="arch-model" value={draft.ai_model ?? ''} onChange={(e) => setDraft({ ...draft, ai_model: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('arch.admin.usage', { docs: ov.documents, versions: ov.versions, shared: ov.shared, attached: ov.attached, systems: ov.systems, ai: ov.ai_today, refused: ov.ai_refused_today })}
            </p>
            <Button onClick={save} disabled={busy}>{t('arch.common.save')}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

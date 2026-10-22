import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Save, Settings2, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useKnowledgeSettings, useSaveKnowledgeSettings, useVersionOptions } from '@/hooks/useInterviewKnowledge';
import { cleanVersion, DEFAULT_KNOWLEDGE_SETTINGS, DEFAULT_VERSION_FAMILIES, type KnowledgeSettings } from '@/lib/interviewKnowledge';

const NUMBERS: Array<[keyof KnowledgeSettings, string, number, number]> = [
  ['min_per_module', 'Questions per module: minimum', 0, 3],
  ['max_per_module', 'Questions per module: maximum', 1, 6],
  ['total_questions', 'Main questions per interview', 3, 16],
  ['max_modules', 'Modules covered at most', 1, 12],
  ['max_docs_per_module', 'Documents per module at most', 1, 200],
  ['max_total_mb', 'Total document size at most (MB)', 10, 2000],
  ['max_ai_calls', 'AI drafting calls per interview at most', 1, 4],
  ['max_excerpts', 'Excerpts passed to the AI at most', 0, 12],
  ['excerpt_chars', 'Characters per excerpt at most', 200, 1200],
];

export default function KnowledgeSettingsPanel({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useKnowledgeSettings();
  const save = useSaveKnowledgeSettings();
  const options = useVersionOptions();
  const [form, setForm] = useState<KnowledgeSettings>(DEFAULT_KNOWLEDGE_SETTINGS);
  const [adding, setAdding] = useState<Record<string, string>>({});
  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);

  const submit = async () => {
    try {
      const saved = await save.mutateAsync(form);
      setForm(saved);
      toast.success(t('ik.settings.saved', 'Settings saved'));
    } catch (e: any) { toast.error(e.message); }
  };

  const rowsOf = (key: string) => (options.data ?? []).filter((r: any) => r.module_key === key);
  const db = supabase as any;
  const refreshOptions = () => qc.invalidateQueries({ queryKey: ['ik', 'version-options'] });
  const customize = async (key: string) => {
    const fam = DEFAULT_VERSION_FAMILIES.find((f) => f.key === key)!;
    const { error } = await db.from('sap_version_options').insert(fam.versions.map((label, i) => ({ module_key: key, label, sort_order: i })));
    if (error) toast.error(error.message); else refreshOptions();
  };
  const addOption = async (key: string) => {
    const label = cleanVersion(adding[key]);
    if (!label) return;
    const { error } = await db.from('sap_version_options').insert({ module_key: key, label, sort_order: rowsOf(key).length });
    if (error) toast.error(error.message); else { setAdding({ ...adding, [key]: '' }); refreshOptions(); }
  };
  const removeOption = async (id: string) => {
    const { error } = await db.from('sap_version_options').delete().eq('id', id);
    if (error) toast.error(error.message); else refreshOptions();
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" />{t('ik.settings.title', 'Knowledge base settings')}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <label className="flex items-start gap-3 rounded-xl border border-border/60 p-4">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} disabled={!ready} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium text-foreground">{t('ik.settings.enabled', 'Use knowledge base for interview questions')}</span>
              <span className="block text-xs text-muted-foreground">{t('ik.settings.enabled_hint', 'Off by default. Switch on only after the owner approves. While off, interviews keep today\'s behaviour.')}</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBERS.map(([key, label, min, max]) => (
              <div key={key}>
                <Label htmlFor={`ik-set-${key}`} className="text-xs">{t(`ik.settings.${key}`, label)}</Label>
                <Input id={`ik-set-${key}`} type="number" inputMode="numeric" min={min} max={max} value={String(form[key])}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value === '' ? '' : Number(e.target.value) } as KnowledgeSettings)} />
              </div>
            ))}
          </div>
          <Button onClick={submit} disabled={save.isPending || settings.isLoading}><Save className="h-4 w-4 me-1.5" />{t('common.save', 'Save')}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base">{t('ik.versions.title', 'Version / release choices in the profile')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('ik.versions.subtitle', 'Consultants pick a release per module from these lists or type their own. Optional unless the owner makes it required.')}</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {DEFAULT_VERSION_FAMILIES.map((fam) => {
            const rows = rowsOf(fam.key);
            return (
              <div key={fam.key} className="rounded-xl border border-border/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{fam.label}</p>
                  {!rows.length && <Button size="sm" variant="outline" disabled={!ready} onClick={() => customize(fam.key)}>{t('ik.versions.customize', 'Edit this list')}</Button>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rows.length
                    ? rows.map((r: any) => (
                      <Badge key={r.id} variant="secondary" className="gap-1 pe-1">{r.label}
                        <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={t('ik.versions.remove', { label: r.label, defaultValue: 'Remove {{label}}' })} onClick={() => removeOption(r.id)}><X className="h-3 w-3" /></button>
                      </Badge>
                    ))
                    : fam.versions.map((v) => <Badge key={v} variant="outline" className="text-muted-foreground">{v}</Badge>)}
                </div>
                {rows.length > 0 && (
                  <div className="flex gap-2">
                    <Input className="h-8 text-xs" maxLength={60} value={adding[fam.key] ?? ''} onChange={(e) => setAdding({ ...adding, [fam.key]: e.target.value })} aria-label={t('ik.versions.add', 'Add a release')} placeholder={t('ik.versions.add', 'Add a release')} />
                    <Button size="sm" variant="outline" className="h-8" onClick={() => addOption(fam.key)}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

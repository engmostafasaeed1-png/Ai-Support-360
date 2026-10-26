// Profile editor: up to 8 success stories. Saved only through the database functions (owner check, filters, limits).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plus, ShieldAlert, Trash2, Trophy, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAchievementActions, useMyAchievements } from '@/hooks/useAchievements';
import { useRoleCatalog } from '@/hooks/useRoleCatalog';
import {
  MAX_ACHIEVEMENTS, OUTCOME_MAX, achievementErrorKey, achievementProblems, achievementWarnings, type Achievement, type AchievementInput,
} from '@/lib/achievements';
import { roleLabel } from '@/lib/consultantRoles';
import AchievementStatusBadge from './AchievementStatusBadge';

const EMPTY: AchievementInput = { title: '', role_played: null, sap_area: '', sap_version: '', industry: '', outcome: '', year: null, reference_url: '' };
const EVIDENCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export default function AchievementsEditor() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { applied, list, isLoading } = useMyAchievements();
  const actions = useAchievementActions();
  const roles = useRoleCatalog();
  const [editing, setEditing] = useState<{ id: string | null; v: AchievementInput; is_public: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (isLoading || !applied) return null;

  const problems = editing ? achievementProblems(editing.v) : [];
  const warnings = editing ? achievementWarnings(editing.v) : [];
  const err = (m?: string | null) => toast.error(t(achievementErrorKey(m), t('achievements.err_generic', 'Could not save. Check the text and try again.')));
  const save = async () => {
    if (!editing) return;
    setBusy('save');
    const { error } = await actions.save(editing.id, { ...editing.v, is_public: editing.is_public });
    setBusy(null);
    if (error) return err(error.message);
    toast.success(t('achievements.saved', 'Success story saved'));
    setEditing(null);
  };
  const set = (patch: Partial<AchievementInput>) => editing && setEditing({ ...editing, v: { ...editing.v, ...patch } });
  const edit = (a: Achievement) => setEditing({ id: a.id, is_public: a.is_public, v: { title: a.title, role_played: a.role_played, sap_area: a.sap_area ?? '', sap_version: a.sap_version ?? '', industry: a.industry ?? '', outcome: a.outcome, year: a.year, reference_url: a.reference_url ?? '' } });

  return (
    <Card className="rounded-2xl border-border/50" id="achievements">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2">
        <CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" /> {t('achievements.title', 'Success stories & achievements')}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, v: EMPTY, is_public: false })}
          reason={(list.length >= MAX_ACHIEVEMENTS && { key: 'already_done', message: t('achievements.max', 'You can add up to {{n}} success stories.', { n: MAX_ACHIEVEMENTS }) }) || (!!editing && { key: 'already_done', message: t('achievements.finish_first', 'Save or cancel the story you are editing first.') })}>
          <Plus className="h-4 w-4 me-1" />{t('achievements.add', 'Add a story')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          {t('achievements.nda_warning', 'Respect your NDAs: no client names, no confidential data, no contact details. Describe a measurable result, for example "cut month-end close from 8 to 4 days". New stories are "Self-declared" until an admin checks your evidence.')}
        </p>
        {list.length === 0 && !editing && <p className="text-sm text-muted-foreground">{t('achievements.empty', 'No success stories yet. They are optional but help clients choose you.')}</p>}
        {list.map((a) => (
          <div key={a.id} className="rounded-xl border border-border/60 p-3 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground">{[a.role_played && roleLabel(a.role_played, lang, roles.catalog), a.sap_area, a.industry, a.year].filter(Boolean).join(' · ')}</p>
              </div>
              <AchievementStatusBadge status={a.status} />
            </div>
            <p className="text-sm text-foreground">{a.outcome}</p>
            {a.review_reason && (a.status === 'hidden' || a.status === 'rejected') && <p className="text-xs text-destructive">{t('achievements.admin_reason', 'Admin note: {{r}}', { r: a.review_reason })}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Switch checked={a.is_public} aria-label={t('achievements.public', 'Show on my public profile')}
                  onCheckedChange={async (v) => { setBusy(a.id); const r = await actions.setPublic(a.id, v); setBusy(null); if (r.error) err(r.error.message); }} />
                {t('achievements.public', 'Show on my public profile')}
              </label>
              <Button size="sm" variant="ghost" onClick={() => edit(a)} reason={!!editing && { key: 'already_done', message: t('achievements.finish_first', 'Save or cancel the story you are editing first.') }}><Pencil className="h-3.5 w-3.5 me-1" />{t('achievements.edit', 'Edit')}</Button>
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary">
                <Upload className="h-3.5 w-3.5" />{a.has_evidence ? t('achievements.evidence_replace', 'Replace evidence') : t('achievements.evidence_add', 'Add evidence (private)')}
                <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = '';
                  if (!f) return;
                  if (!EVIDENCE_TYPES.includes(f.type) || f.size > 5 * 1024 * 1024) return toast.error(t('achievements.evidence_rule', 'PDF, PNG, JPEG or DOCX up to 5 MB.'));
                  setBusy(a.id); const r = await actions.uploadEvidence(a.id, f); setBusy(null);
                  if (r.error) err(r.error.message); else toast.success(t('achievements.evidence_ok', 'Evidence added. Only platform admins can see it.'));
                }} />
              </label>
              <Button size="sm" variant="ghost" className="text-destructive" busy={busy === a.id}
                onClick={async () => { if (!window.confirm(t('achievements.delete_confirm', 'Delete this success story?'))) return; setBusy(a.id); const r = await actions.remove(a.id); setBusy(null); if (r.error) err(r.error.message); }}>
                <Trash2 className="h-3.5 w-3.5 me-1" />{t('achievements.delete', 'Delete')}
              </Button>
            </div>
          </div>
        ))}

        {editing && (
          <div className="rounded-xl border border-primary/30 p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ach-title">{t('achievements.f_title', 'Title')}*</Label>
                <Input id="ach-title" maxLength={120} value={editing.v.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('achievements.f_title_ph', 'e.g. Faster month-end close after S/4HANA migration')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ach-role">{t('achievements.f_role', 'Role you played')}</Label>
                <Select value={editing.v.role_played ?? ''} onValueChange={(v) => set({ role_played: v || null })}>
                  <SelectTrigger id="ach-role"><SelectValue placeholder={t('roles.choose', 'Choose')} /></SelectTrigger>
                  <SelectContent>{roles.enabled.map((r) => <SelectItem key={r.key} value={r.key}>{lang === 'ar' ? r.label_ar : r.label_en}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ach-area">{t('achievements.f_area', 'SAP area / module')}</Label>
                <Input id="ach-area" maxLength={80} value={editing.v.sap_area ?? ''} onChange={(e) => set({ sap_area: e.target.value })} placeholder="SAP FI" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ach-version">{t('achievements.f_version', 'SAP version')}</Label>
                <Input id="ach-version" maxLength={40} value={editing.v.sap_version ?? ''} onChange={(e) => set({ sap_version: e.target.value })} placeholder="S/4HANA 2023" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ach-industry">{t('achievements.f_industry', 'Industry')}</Label>
                <Input id="ach-industry" maxLength={80} value={editing.v.industry ?? ''} onChange={(e) => set({ industry: e.target.value })} placeholder={t('achievements.f_industry_ph', 'e.g. Retail')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ach-year">{t('achievements.f_year', 'Year')}</Label>
                <Input id="ach-year" type="number" min={1980} max={new Date().getFullYear()} value={editing.v.year ?? ''} onChange={(e) => set({ year: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ach-outcome">{t('achievements.f_outcome', 'Outcome (measurable result)')}*</Label>
                <Textarea id="ach-outcome" rows={3} maxLength={OUTCOME_MAX} value={editing.v.outcome} onChange={(e) => set({ outcome: e.target.value })}
                  placeholder={t('achievements.f_outcome_ph', 'e.g. Cut month-end close from 8 to 4 days for a 3-company group.')} />
                <p className="text-[11px] text-muted-foreground">{editing.v.outcome.length}/{OUTCOME_MAX}</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ach-link">{t('achievements.f_link', 'Public reference link (optional)')}</Label>
                <Input id="ach-link" type="url" maxLength={300} value={editing.v.reference_url ?? ''} onChange={(e) => set({ reference_url: e.target.value })} placeholder="https://www.linkedin.com/…" />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch checked={editing.is_public} onCheckedChange={(v) => setEditing({ ...editing, is_public: v })} aria-label={t('achievements.public', 'Show on my public profile')} />
                {t('achievements.public', 'Show on my public profile')}
              </label>
            </div>
            {problems.length > 0 && (
              <ul className="space-y-1 text-xs text-destructive" role="alert">{problems.map((p) => <li key={p}>{t(`achievements.p_${p}`)}</li>)}</ul>
            )}
            {warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-warning-foreground">{warnings.map((w) => <li key={w} className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />{t(`achievements.w_${w}`)}</li>)}</ul>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} busy={busy === 'save'} reason={problems.length > 0 && { key: 'fix_errors_first', message: problems.map((p) => t(`achievements.p_${p}`)).join(' ') }}>{t('achievements.save', 'Save story')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('achievements.cancel', 'Cancel')}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

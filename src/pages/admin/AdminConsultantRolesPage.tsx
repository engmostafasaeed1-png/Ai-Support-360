// Admin: the consultant role catalogue (labels EN/AR, category, on/off, order, add a role) and the optional suggested
// hourly-rate range per category. Works once docs/sql/consultant-roles.sql is applied; until then it explains that.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROLE_CATALOG_KEY, useRoleCatalog, useRoleSettings } from '@/hooks/useRoleCatalog';
import { CATEGORY_LABELS, ROLE_CATEGORIES, isRoleKey, type RoleCategory, type RoleEntry, type RoleSettings } from '@/lib/consultantRoles';

const db = supabase as any;

export default function AdminConsultantRolesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const qc = useQueryClient();
  const { catalog, applied, isLoading } = useRoleCatalog();
  const settings = useRoleSettings();
  const [rows, setRows] = useState<RoleEntry[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState({ key: '', label_en: '', label_ar: '', category: 'other' as RoleCategory });
  const [ranges, setRanges] = useState<NonNullable<RoleSettings['rate_ranges']>>({});
  useEffect(() => setRows(catalog), [catalog]);
  useEffect(() => setRanges(settings.data?.rate_ranges ?? {}), [settings.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ROLE_CATALOG_KEY });
  const save = async (r: RoleEntry) => {
    setBusyKey(r.key);
    const { error } = await db.from('consultant_role_catalog').update({ label_en: r.label_en.trim(), label_ar: r.label_ar.trim(), category: r.category, enabled: r.enabled, sort: r.sort, updated_at: new Date().toISOString() }).eq('key', r.key);
    setBusyKey(null);
    if (error) return toast.error(error.message);
    toast.success(t('roles.admin_saved', 'Saved'));
    refresh();
  };
  const add = async () => {
    setBusyKey('new');
    const { error } = await db.from('consultant_role_catalog').insert({ ...draft, key: draft.key.trim(), label_en: draft.label_en.trim(), label_ar: draft.label_ar.trim(), sort: 900 });
    setBusyKey(null);
    if (error) return toast.error(error.message);
    setDraft({ key: '', label_en: '', label_ar: '', category: 'other' });
    refresh();
  };
  const saveRanges = async () => {
    setBusyKey('ranges');
    const clean: NonNullable<RoleSettings['rate_ranges']> = {};
    for (const [c, r] of Object.entries(ranges)) if (r && Number(r.min) > 0 && Number(r.max) >= Number(r.min)) clean[c as RoleCategory] = { min: Number(r.min), max: Number(r.max) };
    const { error } = await db.from('platform_settings').update({ value: { ...(settings.data ?? {}), rate_ranges: clean } }).eq('key', 'consultant_roles');
    setBusyKey(null);
    if (error) return toast.error(error.message);
    toast.success(t('roles.admin_saved', 'Saved'));
    qc.invalidateQueries({ queryKey: ['consultant-role-settings'] });
  };
  const set = (key: string, patch: Partial<RoleEntry>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const notReady = !applied && 'feature_disabled_by_admin';
  const addProblem = !isRoleKey(draft.key.trim()) || draft.label_en.trim().length < 2 || draft.label_ar.trim().length < 2;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t('roles.admin_title', 'Consultant roles')}</h1>
        <p className="text-sm text-muted-foreground">{t('roles.admin_hint', 'All SAP-related jobs consultants can choose. Switch a role off instead of deleting it; consultants who already chose it keep it.')}</p>
        {!isLoading && !applied && <p role="status" className="mt-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">{t('roles.admin_not_applied', 'The role catalogue is not in the database yet. The built-in list is shown and used; editing starts after the prepared database update is applied.')}</p>}
      </header>

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base">{t('roles.admin_catalogue', 'Role catalogue')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="hidden md:grid grid-cols-[10rem_1fr_1fr_12rem_4rem_4rem_6rem] gap-2 text-[11px] font-medium text-muted-foreground">
            <span>{t('roles.admin_key', 'Key')}</span><span>English</span><span>العربية</span><span>{t('roles.admin_category', 'Category')}</span><span>{t('roles.admin_order', 'Order')}</span><span>{t('roles.admin_on', 'On')}</span><span />
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-1 md:grid-cols-[10rem_1fr_1fr_12rem_4rem_4rem_6rem] gap-2 items-center border-b border-border/40 pb-2 md:border-0 md:pb-0">
              <code className="text-xs text-muted-foreground truncate">{r.key}</code>
              <Input aria-label={`${r.key} English`} value={r.label_en} maxLength={80} onChange={(e) => set(r.key, { label_en: e.target.value })} className="h-8 text-xs" />
              <Input aria-label={`${r.key} Arabic`} dir="rtl" value={r.label_ar} maxLength={80} onChange={(e) => set(r.key, { label_ar: e.target.value })} className="h-8 text-xs" />
              <Select value={r.category} onValueChange={(v) => set(r.key, { category: v as RoleCategory })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c][lang]}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label={`${r.key} order`} type="number" value={r.sort} onChange={(e) => set(r.key, { sort: Number(e.target.value) || 0 })} className="h-8 text-xs" />
              <Switch aria-label={`${r.key} on`} checked={r.enabled} onCheckedChange={(v) => set(r.key, { enabled: v })} />
              <Button size="sm" variant="outline" className="h-8" onClick={() => save(r)} busy={busyKey === r.key}
                reason={notReady || ((r.label_en.trim().length < 2 || r.label_ar.trim().length < 2) && 'fill_required_fields')}>{t('roles.admin_save', 'Save')}</Button>
            </div>
          ))}
          <div className="grid grid-cols-1 md:grid-cols-[10rem_1fr_1fr_12rem_8rem] gap-2 items-center pt-3">
            <Input aria-label={t('roles.admin_key', 'Key')} placeholder="e.g. ams_lead" value={draft.key} maxLength={40} onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })} className="h-8 text-xs" />
            <Input aria-label="English" placeholder="English label" value={draft.label_en} maxLength={80} onChange={(e) => setDraft({ ...draft, label_en: e.target.value })} className="h-8 text-xs" />
            <Input aria-label="Arabic" dir="rtl" placeholder="الاسم بالعربية" value={draft.label_ar} maxLength={80} onChange={(e) => setDraft({ ...draft, label_ar: e.target.value })} className="h-8 text-xs" />
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as RoleCategory })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c][lang]}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" className="h-8" onClick={add} busy={busyKey === 'new'} reason={notReady || (addProblem && 'fill_required_fields')}>{t('roles.admin_add', 'Add role')}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base">{t('roles.admin_rates', 'Suggested hourly-rate range per category (optional)')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('roles.admin_rates_hint', 'Shown to consultants as advice under their hourly rate. It does not limit or change any rate; leave empty to show nothing.')}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {ROLE_CATEGORIES.filter((c) => c !== 'other').map((c) => (
            <div key={c} className="grid grid-cols-[1fr_6rem_6rem] gap-2 items-center">
              <span className="text-sm text-foreground">{CATEGORY_LABELS[c][lang]}</span>
              <Input aria-label={`${c} min`} type="number" min={0} placeholder="min" value={ranges[c]?.min ?? ''} onChange={(e) => setRanges({ ...ranges, [c]: { ...ranges[c], min: e.target.value === '' ? undefined : Number(e.target.value) } })} className="h-8 text-xs" />
              <Input aria-label={`${c} max`} type="number" min={0} placeholder="max" value={ranges[c]?.max ?? ''} onChange={(e) => setRanges({ ...ranges, [c]: { ...ranges[c], max: e.target.value === '' ? undefined : Number(e.target.value) } })} className="h-8 text-xs" />
            </div>
          ))}
          <Button size="sm" onClick={saveRanges} busy={busyKey === 'ranges'} reason={notReady}>{t('roles.admin_save', 'Save')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

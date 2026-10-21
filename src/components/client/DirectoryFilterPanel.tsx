import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Trash2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TaxonomySelect from '@/components/profile/TaxonomySelect';
import { INDUSTRY_EXPERIENCE, CUSTOMER_SEGMENTS, LOCALIZATION_COUNTRIES, VERTICAL_SOLUTIONS, DEPLOYMENT_EXPERIENCE, WORK_MODES } from '@/lib/profileTaxonomy';
import { SAP_ROLES } from '@/components/consultant/SapExpertiseCard';
import type { ConsultantLive } from '@/lib/consultantDirectory';
import {
  FAMILY_OPTIONS, MODULE_OPTIONS, RATE_MAX, facetCounts, type DirectoryContext, type DirectoryFilters,
} from '@/lib/directoryFilters';
import { SUB_MODULE_CODES } from '../../../supabase/functions/_shared/ticketMatch';
import type { SavedFilter } from '@/lib/savedFilters';

const ANY = '__any__';
const RESP_OPTIONS = ['excellent', 'good', 'fair'] as const;
const RESP_LABEL: Record<(typeof RESP_OPTIONS)[number], string> = { excellent: 'Excellent', good: 'Good or better', fair: 'Fair or better' };

type Option = { value: string; label: string };

function FacetSelect({ id, label, value, options, counts, onChange, anyLabel }: {
  id: string; label: string; value: string; options: Option[]; counts?: Map<string, number>; onChange: (v: string) => void; anyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
        <SelectTrigger id={id} className="h-9 rounded-xl text-xs" aria-label={label}><SelectValue placeholder={anyLabel} /></SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((o) => {
            const n = counts?.get(o.value);
            return (
              <SelectItem key={o.value} value={o.value} disabled={n === 0 && o.value !== value}>
                {o.label}{n !== undefined ? ` (${n})` : ''}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

interface Props {
  filters: DirectoryFilters;
  consultants: ConsultantLive[];
  ctx: DirectoryContext;
  onChange: (patch: Partial<DirectoryFilters>) => void;
  onClear: () => void;
  saved: SavedFilter[];
  onSave: (name: string) => void;
  onApplySaved: (query: string) => void;
  onDeleteSaved: (name: string) => void;
}

export default function DirectoryFilterPanel({ filters: f, consultants, ctx, onChange, onClear, saved, onSave, onApplySaved, onDeleteSaved }: Props) {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const anyLabel = t('directory.any', 'Any');
  const [saveName, setSaveName] = useState('');

  const counts = <K extends keyof DirectoryFilters>(key: K, values: Array<DirectoryFilters[K]>) =>
    facetCounts(consultants, f, key, values, ctx) as unknown as Map<string, number>;

  const skills = useMemo(() => [...new Set(consultants.flatMap((c) => c.skills ?? []))].sort((a, b) => a.localeCompare(b)).slice(0, 200), [consultants]);
  const modules = MODULE_OPTIONS.filter((m) => !f.family || m.family === f.family);
  const languages: Option[] = [
    { value: 'en', label: t('directory.lang_en', 'English') }, { value: 'ar', label: t('directory.lang_ar', 'Arabic') },
    { value: 'fr', label: t('directory.lang_fr', 'French') }, { value: 'de', label: t('directory.lang_de', 'German') },
    { value: 'hi', label: t('directory.lang_hi', 'Hindi') }, { value: 'ur', label: t('directory.lang_ur', 'Urdu') },
  ];
  const tiers: Option[] = [
    { value: 'gold', label: t('directory.tier_gold', 'Gold') }, { value: 'silver', label: t('directory.tier_silver', 'Silver or higher') },
    { value: 'bronze', label: t('directory.tier_bronze', 'Bronze or higher') }, { value: 'verified', label: t('directory.tier_verified', 'Any badge (Verified or higher)') },
  ];
  const zones: Option[] = [
    { value: 'near', label: t('directory.tz_near', 'Close to my time zone (±2 h)') },
    ...['Asia/Riyadh', 'Asia/Dubai', 'Africa/Cairo', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'America/New_York'].map((z) => ({ value: z, label: `${z} (±2 h)` })),
  ];
  const days = ar ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const switchCount = (key: 'verified' | 'founding' | 'credly') => counts(key, [true]).get(true as unknown as string) ?? 0;

  return (
    <Card className="rounded-2xl border-border/50 animate-fade-in">
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FacetSelect id="f-area" label={t('directory.sap_area', 'SAP area')} value={f.family} anyLabel={anyLabel}
            options={FAMILY_OPTIONS.map((o) => ({ value: o.value, label: o.label[ar ? 1 : 0] }))}
            counts={counts('family', FAMILY_OPTIONS.map((o) => o.value))} onChange={(v) => onChange({ family: v, module: '' })} />
          <FacetSelect id="f-module" label={t('directory.module', 'SAP module')} value={f.module} anyLabel={anyLabel}
            options={modules.map((m) => ({ value: m.value, label: m.label }))} counts={counts('module', modules.map((m) => m.value))} onChange={(v) => onChange({ module: v })} />
          <FacetSelect id="f-sub" label={t('directory.sub_module', 'Sub-module')} value={f.sub} anyLabel={anyLabel}
            options={SUB_MODULE_CODES.map((c) => ({ value: c, label: c }))} counts={counts('sub', SUB_MODULE_CODES)} onChange={(v) => onChange({ sub: v })} />
          <FacetSelect id="f-role" label={t('directory.role', 'Role')} value={f.role} anyLabel={anyLabel}
            options={SAP_ROLES.map(([v, l]) => ({ value: v, label: t(`directory.role_${v}`, l) }))} counts={counts('role', SAP_ROLES.map(([v]) => v))} onChange={(v) => onChange({ role: v })} />
          <FacetSelect id="f-skill" label={t('directory.skill', 'Skill')} value={f.skill} anyLabel={anyLabel}
            options={skills.map((s) => ({ value: s, label: s }))} counts={counts('skill', skills)} onChange={(v) => onChange({ skill: v })} />
          <div className="space-y-1.5">
            <Label htmlFor="f-cert" className="text-xs font-medium text-muted-foreground">{t('directory.certification', 'Certification')}</Label>
            <Input id="f-cert" value={f.cert} maxLength={120} placeholder={t('directory.cert_placeholder', 'e.g. S/4HANA Finance')} className="h-9 rounded-xl text-xs"
              onChange={(e) => onChange({ cert: e.target.value })} />
          </div>
          <FacetSelect id="f-years" label={t('directory.years', 'Years of experience')} value={f.years ? String(f.years) : ''} anyLabel={anyLabel}
            options={[3, 5, 10, 15].map((y) => ({ value: String(y), label: t('directory.years_min', '{{n}}+ years', { n: y }) }))}
            counts={new Map([3, 5, 10, 15].map((y) => [String(y), counts('years', [y]).get(y as unknown as string) ?? 0]))}
            onChange={(v) => onChange({ years: Number(v) || 0 })} />
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t('directory.industry', 'Industry')}</Label>
            <TaxonomySelect groups={INDUSTRY_EXPERIENCE} value={f.industry} noneLabel={anyLabel} ariaLabel={t('directory.industry', 'Industry')} className="h-9 rounded-xl text-xs" onChange={(v) => onChange({ industry: v })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t('directory.segment', 'Customer segment')}</Label>
            <TaxonomySelect groups={CUSTOMER_SEGMENTS} value={f.segment} noneLabel={anyLabel} ariaLabel={t('directory.segment', 'Customer segment')} className="h-9 rounded-xl text-xs" onChange={(v) => onChange({ segment: v })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t('directory.country', 'Country / localization')}</Label>
            <TaxonomySelect groups={LOCALIZATION_COUNTRIES} value={f.country} noneLabel={anyLabel} ariaLabel={t('directory.country', 'Country / localization')} className="h-9 rounded-xl text-xs" onChange={(v) => onChange({ country: v })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t('directory.vertical', 'Vertical solution')}</Label>
            <TaxonomySelect groups={VERTICAL_SOLUTIONS} value={f.vertical} noneLabel={anyLabel} ariaLabel={t('directory.vertical', 'Vertical solution')} className="h-9 rounded-xl text-xs" onChange={(v) => onChange({ vertical: v })} />
          </div>
          <FacetSelect id="f-deploy" label={t('directory.deployment', 'Deployment experience')} value={f.deployment} anyLabel={anyLabel}
            options={DEPLOYMENT_EXPERIENCE.filter((d) => d !== 'Other').map((d) => ({ value: d, label: d }))} counts={counts('deployment', DEPLOYMENT_EXPERIENCE)} onChange={(v) => onChange({ deployment: v })} />
          <FacetSelect id="f-mode" label={t('directory.work_mode', 'Work mode')} value={f.workMode} anyLabel={anyLabel}
            options={WORK_MODES.map((m) => ({ value: m, label: m }))} counts={counts('workMode', WORK_MODES)} onChange={(v) => onChange({ workMode: v })} />
          <FacetSelect id="f-lang" label={t('directory.language', 'Language')} value={f.lang} anyLabel={anyLabel}
            options={languages} counts={counts('lang', languages.map((l) => l.value))} onChange={(v) => onChange({ lang: v })} />
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {t('directory.rate', 'Hourly rate')}: ${f.rateMin} – ${f.rateMax}{f.rateMax >= RATE_MAX ? '+' : ''}
            </Label>
            <Slider value={[f.rateMin, f.rateMax]} min={0} max={RATE_MAX} step={10} className="pt-2" aria-label={t('directory.rate', 'Hourly rate')}
              onValueChange={(v) => onChange({ rateMin: v[0], rateMax: v[1] })} />
          </div>
          <FacetSelect id="f-avail" label={t('directory.availability', 'Availability')} value={f.avail === 'any' ? '' : f.avail} anyLabel={anyLabel}
            options={[
              { value: 'now', label: t('directory.avail_now', 'Available now') },
              { value: 'week', label: t('directory.avail_week', 'Available this week') },
              { value: 'slot', label: t('directory.avail_slot', 'At a specific time') },
            ]}
            counts={new Map(['now', 'week'].map((v) => [v, counts('avail', [v as DirectoryFilters['avail']]).get(v) ?? 0]))}
            onChange={(v) => onChange({ avail: (v || 'any') as DirectoryFilters['avail'] })} />
          {f.avail === 'slot' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="f-day" className="text-xs font-medium text-muted-foreground">{t('directory.day', 'Day')}</Label>
                <Select value={f.slotDay === null ? ANY : String(f.slotDay)} onValueChange={(v) => onChange({ slotDay: v === ANY ? null : Number(v) })}>
                  <SelectTrigger id="f-day" className="h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{anyLabel}</SelectItem>
                    {days.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-time" className="text-xs font-medium text-muted-foreground">{t('directory.time_local', 'Time (your time)')}</Label>
                <Input id="f-time" type="time" step={1800} value={f.slotTime} className="h-9 rounded-xl text-xs" onChange={(e) => onChange({ slotTime: e.target.value })} />
              </div>
            </div>
          )}
          <FacetSelect id="f-tz" label={t('directory.timezone', 'Time zone')} value={f.tz} anyLabel={anyLabel}
            options={zones} counts={counts('tz', zones.map((z) => z.value))} onChange={(v) => onChange({ tz: v })} />
          <FacetSelect id="f-tier" label={t('directory.badge_tier', 'AI interview badge')} value={f.tier} anyLabel={anyLabel}
            options={tiers} counts={counts('tier', tiers.map((x) => x.value) as DirectoryFilters['tier'][])} onChange={(v) => onChange({ tier: v as DirectoryFilters['tier'] })} />
          <FacetSelect id="f-rating" label={t('directory.min_rating', 'Minimum rating')} value={f.rating ? String(f.rating) : ''} anyLabel={anyLabel}
            options={[3, 3.5, 4, 4.5].map((r) => ({ value: String(r), label: `${r}+ ★` }))}
            counts={new Map([3, 3.5, 4, 4.5].map((r) => [String(r), counts('rating', [r]).get(r as unknown as string) ?? 0]))}
            onChange={(v) => onChange({ rating: Number(v) || 0 })} />
          <FacetSelect id="f-completion" label={t('directory.completion', 'Profile completion')} value={f.completion ? String(f.completion) : ''} anyLabel={anyLabel}
            options={[50, 70, 90, 100].map((p) => ({ value: String(p), label: t('directory.completion_min', 'At least {{n}} %', { n: p }) }))}
            counts={new Map([50, 70, 90, 100].map((p) => [String(p), counts('completion', [p]).get(p as unknown as string) ?? 0]))}
            onChange={(v) => onChange({ completion: Number(v) || 0 })} />
          <FacetSelect id="f-response" label={t('directory.response', 'Response time')} value={f.response ? String(f.response) : ''} anyLabel={anyLabel}
            options={[30, 60, 240, 1440].map((m) => ({ value: String(m), label: m < 60 ? t('directory.within_min', 'Within {{n}} min', { n: m }) : t('directory.within_h', 'Within {{n}} h', { n: m / 60 }) }))}
            counts={new Map([30, 60, 240, 1440].map((m) => [String(m), counts('response', [m]).get(m as unknown as string) ?? 0]))}
            onChange={(v) => onChange({ response: Number(v) || 0 })} />
          {ctx.respLevels && (
            <FacetSelect id="f-resp" label={t('directory.responsiveness', 'Responsiveness')} value={f.resp} anyLabel={anyLabel}
              options={RESP_OPTIONS.map((o) => ({ value: o, label: t(`directory.resp_${o}`, RESP_LABEL[o]) }))}
              counts={counts('resp', [...RESP_OPTIONS])} onChange={(v) => onChange({ resp: v as DirectoryFilters['resp'] })} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/50 pt-4">
          {([
            ['verified', t('directory.verified_only', 'Verified only')],
            ['founding', t('directory.founding_only', 'Founding Consultants')],
            ['credly', t('directory.credly_only', 'Credly profile only')],
          ] as const).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <Switch id={`f-${key}`} checked={f[key]} onCheckedChange={(v) => onChange({ [key]: v } as Partial<DirectoryFilters>)} />
              <Label htmlFor={`f-${key}`} className="cursor-pointer text-xs">{label} <span className="text-muted-foreground">({switchCount(key)})</span></Label>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-border/50 pt-4">
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (saveName.trim()) { onSave(saveName); setSaveName(''); } }}>
            <div className="space-y-1.5">
              <Label htmlFor="f-save" className="text-xs font-medium text-muted-foreground">{t('directory.save_name', 'Save these filters as')}</Label>
              <Input id="f-save" value={saveName} maxLength={40} placeholder={t('directory.save_placeholder', 'e.g. FI Saudi')} className="h-9 w-44 rounded-xl text-xs" onChange={(e) => setSaveName(e.target.value)} />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-9 gap-1 text-xs" disabled={!saveName.trim()}>
              <Bookmark className="h-3.5 w-3.5" aria-hidden /> {t('directory.save', 'Save filters')}
            </Button>
          </form>
          {saved.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('directory.saved', 'Saved')}:</span>
              {saved.map((s) => (
                <span key={s.name} className="inline-flex items-center rounded-full border border-border bg-muted/40 text-xs">
                  <button type="button" className="px-2.5 py-1 hover:text-primary" onClick={() => onApplySaved(s.query)}>{s.name}</button>
                  <button type="button" className="pe-2 text-muted-foreground hover:text-destructive" aria-label={t('directory.delete_saved', 'Delete saved filters {{name}}', { name: s.name })} onClick={() => onDeleteSaved(s.name)}>
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="ms-auto text-xs text-muted-foreground" onClick={onClear}>
            <X className="me-1 h-3 w-3" aria-hidden /> {t('directory.clear_all', 'Clear all')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

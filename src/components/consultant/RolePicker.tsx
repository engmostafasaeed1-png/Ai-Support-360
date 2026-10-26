// Picks SAP professional roles from the catalogue, grouped by category. With `withPrimary` the first value is the main role
// (chosen in a select) and the chips add up to max-1 more. Unknown legacy values stay visible as removable "Other" chips.
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CATEGORY_LABELS, ROLE_CATEGORIES, roleKeyFor, roleLabel, type RoleEntry } from '@/lib/consultantRoles';

type Props = {
  catalog: RoleEntry[];
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  withPrimary?: boolean;
  idPrefix?: string;
  required?: boolean;
};

export default function RolePicker({ catalog, value, onChange, max, withPrimary = false, idPrefix = 'role', required }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const enabled = catalog.filter((r) => r.enabled);
  const keyOf = (v: string) => roleKeyFor(v, catalog) ?? v;
  const keys = value.map(keyOf);
  const primary = withPrimary ? keys[0] ?? '' : '';
  const more = withPrimary ? keys.slice(1) : keys;
  const unknown = keys.filter((k) => !catalog.some((r) => r.key === k));
  const atMax = keys.length >= max;
  const groups = ROLE_CATEGORIES.map((c) => ({ c, items: enabled.filter((r) => r.category === c) })).filter((g) => g.items.length > 0);

  const setPrimary = (k: string) => onChange([k, ...keys.filter((x) => x !== k)]);
  const toggle = (k: string) => {
    if (keys.includes(k)) onChange(keys.filter((x) => x !== k));
    else if (!atMax) onChange(withPrimary && keys.length === 0 ? [k] : [...keys, k]);
  };

  return (
    <div className="space-y-3">
      {withPrimary && (
        <div className="space-y-1.5 max-w-md">
          <Label htmlFor={`${idPrefix}-primary`}>{t('roles.primary', 'Main role')}{required && <span className="text-destructive ms-0.5" aria-hidden>*</span>}</Label>
          <Select value={primary} onValueChange={setPrimary}>
            <SelectTrigger id={`${idPrefix}-primary`}><SelectValue placeholder={t('roles.primary_placeholder', 'Choose your main role')} /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectGroup key={g.c}>
                  <SelectLabel>{CATEGORY_LABELS[g.c][lang]}</SelectLabel>
                  {g.items.map((r) => <SelectItem key={r.key} value={r.key}>{lang === 'ar' ? r.label_ar : r.label_en}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        {withPrimary && <p className="text-sm font-medium text-foreground">{t('roles.more', 'More roles (up to {{n}})', { n: max - 1 })}</p>}
        {groups.map((g) => (
          <div key={g.c} className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[g.c][lang]}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.filter((r) => r.key !== primary).map((r) => {
                const on = more.includes(r.key);
                const blocked = !on && (atMax || (withPrimary && !primary));
                return (
                  <button key={r.key} type="button" aria-pressed={on} aria-disabled={blocked || undefined}
                    title={blocked ? (withPrimary && !primary ? t('roles.pick_primary_first', 'Choose your main role first.') : t('roles.max_reached', 'You can choose up to {{n}} roles.', { n: max })) : undefined}
                    onClick={() => { if (!blocked || on) (withPrimary && !primary ? setPrimary(r.key) : toggle(r.key)); }}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : blocked ? 'border-border bg-background text-muted-foreground/60' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}>
                    {lang === 'ar' ? r.label_ar : r.label_en}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {unknown.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('roles.legacy', 'Other (from your earlier profile)')}</p>
            <div className="flex flex-wrap gap-1.5">
              {unknown.map((k) => (
                <button key={k} type="button" onClick={() => onChange(keys.filter((x) => x !== k))} aria-label={t('roles.remove', 'Remove {{name}}', { name: k })}
                  className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs text-foreground">
                  {roleLabel(k, lang, catalog)}<X className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {t('roles.count', '{{n}} of {{max}} chosen', { n: keys.length, max })}
        </p>
      </div>
    </div>
  );
}

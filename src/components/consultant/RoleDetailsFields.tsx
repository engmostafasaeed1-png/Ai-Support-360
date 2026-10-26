// Editor for the role details of the consultant's categories (lists, numbers, ranges, short texts). Lists come from the
// admin's lists or the built-in ones, plus free "other" entries; contact details are refused before saving.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROLE_DETAIL_SPEC, detailOptions, fieldAppliesToRoles, type RoleDetails, type RoleEntry, type RoleSettings } from '@/lib/consultantRoles';

type Props = {
  roles: string[];
  catalog: RoleEntry[];
  settings?: RoleSettings | null;
  value: RoleDetails;
  onChange: (next: RoleDetails) => void;
  isVisible: (key: string) => boolean;
  isRequired: (key: string) => boolean;
};

function ListChips({ id, options, value, onChange }: { id: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [other, setOther] = useState('');
  const extras = value.filter((v) => !options.includes(v));
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o].slice(0, 12));
  const add = () => { const v = other.trim().slice(0, 80); if (v && !value.includes(v)) onChange([...value, v].slice(0, 12)); setOther(''); };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[...options, ...extras].map((o) => {
          const on = value.includes(o);
          return (
            <button key={o} type="button" aria-pressed={on} onClick={() => toggle(o)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}>{o}</button>
          );
        })}
      </div>
      <div className="flex gap-2 max-w-sm">
        <Input id={`${id}-other`} aria-label={t('roles.other_entry', 'Other (type and press Add)')} value={other} maxLength={80} className="h-8 text-xs"
          placeholder={t('roles.other_entry', 'Other (type and press Add)')} onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={add} reason={!other.trim() && 'fill_required_fields'}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

export default function RoleDetailsFields({ roles, catalog, settings, value, onChange, isVisible, isRequired }: Props) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const specs = ROLE_DETAIL_SPEC.filter((s) => fieldAppliesToRoles(s.key, roles, catalog) && isVisible(s.key));
  if (specs.length === 0) return null;
  const set = (k: string, v: RoleDetails[string]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {specs.map((s) => {
        const id = `role-detail-${s.key}`;
        const label = <Label htmlFor={id}>{ar ? s.ar : s.en}{isRequired(s.key) && <span className="text-destructive ms-0.5" aria-hidden>*</span>}</Label>;
        if (s.kind === 'list') return (
          <div key={s.key} className="space-y-1.5 sm:col-span-2">{label}
            <ListChips id={id} options={detailOptions(s, settings)} value={Array.isArray(value[s.key]) ? (value[s.key] as string[]) : []} onChange={(v) => set(s.key, v)} />
          </div>
        );
        if (s.kind === 'number') return (
          <div key={s.key} className="space-y-1.5">{label}
            <Input id={id} type="number" min={0} max={100000} value={typeof value[s.key] === 'number' ? (value[s.key] as number) : ''}
              onChange={(e) => set(s.key, e.target.value === '' ? null : Number(e.target.value))} />
          </div>
        );
        if (s.kind === 'choice') return (
          <div key={s.key} className="space-y-1.5">{label}
            <Select value={typeof value[s.key] === 'string' ? (value[s.key] as string) : ''} onValueChange={(v) => set(s.key, v)}>
              <SelectTrigger id={id}><SelectValue placeholder={t('roles.choose', 'Choose')} /></SelectTrigger>
              <SelectContent>{detailOptions(s, settings).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        );
        return (
          <div key={s.key} className="space-y-1.5 sm:col-span-2">{label}
            <Textarea id={id} rows={3} maxLength={600} value={typeof value[s.key] === 'string' ? (value[s.key] as string) : ''} onChange={(e) => set(s.key, e.target.value)} />
            <p className="text-[11px] text-muted-foreground">{t('roles.no_prices', 'Do not include prices, discounts or contact details.')}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Read-only view of the same details on the public profile (only filled fields). */
export function RoleDetailsView({ details }: { details: RoleDetails | null | undefined }) {
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const rows = ROLE_DETAIL_SPEC.flatMap((s) => {
    const v = details?.[s.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return [];
    return [{ s, v }];
  });
  if (!rows.length) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(({ s, v }) => (
        <div key={s.key} className={s.kind === 'list' || s.kind === 'text' ? 'sm:col-span-2' : ''}>
          <dt className="text-xs font-medium text-muted-foreground">{ar ? s.ar : s.en}</dt>
          <dd className="mt-1 text-sm text-foreground">
            {Array.isArray(v) ? <span className="flex flex-wrap gap-1.5">{v.map((x) => <span key={x} className="rounded-full bg-muted px-2 py-0.5 text-xs">{x}</span>)}</span> : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FAMILY_OPTIONS, MODULE_OPTIONS } from '@/lib/directoryFilters';
import { FAV_LIMITS, GROUP_COLOURS, GROUP_ICONS, GROUP_TONE, groupProblems, type ConsultantGroup, type GroupColour, type GroupIcon as GroupIconName } from '@/lib/clientFavourites';
import { GroupIcon } from './GroupIcon';

export interface GroupDraftValue { name: string; description: string | null; colour: GroupColour; icon: GroupIconName; preferred_areas: string[] }

export default function GroupEditorDialog({ open, onOpenChange, group, otherNames, onSave, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: ConsultantGroup | null;
  otherNames: string[];
  onSave: (v: GroupDraftValue) => void | Promise<void>;
  saving?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const ar = !!i18n.language?.startsWith('ar');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [colour, setColour] = useState<GroupColour>('blue');
  const [icon, setIcon] = useState<GroupIconName>('users');
  const [areas, setAreas] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setColour(group?.colour ?? 'blue');
    setIcon(group?.icon ?? 'users');
    setAreas(group?.preferred_areas ?? []);
    setTouched(false);
  }, [open, group]);

  const problems = groupProblems({ name, description, colour, icon, preferred_areas: areas }, otherNames);
  const toggleArea = (v: string) => setAreas((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const areaOptions = [
    ...FAMILY_OPTIONS.map((f) => ({ value: f.value.toUpperCase(), label: ar ? f.label[1] : f.label[0] })),
    ...MODULE_OPTIONS.map((m) => ({ value: m.value.toUpperCase(), label: m.label })),
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problems.length) return;
    void onSave({ name: name.replace(/\s+/g, ' ').trim(), description: description.trim() || null, colour, icon, preferred_areas: areas });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{group ? t('fav.edit_group') : t('fav.new_group')}</DialogTitle>
            <DialogDescription>{t('fav.group_hint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="grp-name">{t('fav.group_name')}</Label>
            <Input id="grp-name" value={name} maxLength={FAV_LIMITS.groupName + 10} onChange={(e) => setName(e.target.value)} placeholder={t('fav.group_name_ph')}
              aria-invalid={touched && problems.some((p) => p.startsWith('name'))} aria-describedby="grp-name-err" />
            {touched && problems.filter((p) => p.startsWith('name')).map((p) => <p key={p} id="grp-name-err" className="text-xs text-destructive">{t(`fav.problem.${p}`)}</p>)}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grp-desc">{t('fav.group_description')}</Label>
            <Textarea id="grp-desc" value={description} rows={2} onChange={(e) => setDescription(e.target.value)} aria-describedby="grp-desc-count" />
            <p id="grp-desc-count" className={cn('text-xs', description.length > FAV_LIMITS.groupDescription ? 'text-destructive' : 'text-muted-foreground')}>{description.length} / {FAV_LIMITS.groupDescription}</p>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('fav.group_colour')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('fav.group_colour')}>
              {GROUP_COLOURS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={t(`fav.colour.${c}`)} onClick={() => setColour(c)}
                  className={cn('h-8 w-8 rounded-full border-2', GROUP_TONE[c], colour === c ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '')} />
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('fav.group_icon')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('fav.group_icon')}>
              {GROUP_ICONS.map((ic) => (
                <button key={ic} type="button" role="radio" aria-checked={icon === ic} aria-label={t(`fav.icon.${ic}`)} onClick={() => setIcon(ic)}
                  className={cn('flex h-9 w-9 items-center justify-center rounded-lg border', icon === ic ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                  <GroupIcon icon={ic} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('fav.preferred_areas')}</legend>
            <p className="text-xs text-muted-foreground">{t('fav.preferred_areas_hint')}</p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {areaOptions.map((o) => (
                <button key={o.value} type="button" aria-pressed={areas.includes(o.value)} onClick={() => toggleArea(o.value)}
                  className={cn('rounded-full border px-2 py-0.5 text-xs', areas.includes(o.value) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                  {o.label}
                </button>
              ))}
            </div>
            {touched && problems.includes('areas_limit') && <p className="text-xs text-destructive">{t('fav.problem.areas_limit')}</p>}
          </fieldset>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" disabled={saving}>{t('fav.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

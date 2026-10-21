import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAvailabilityActions, useMyAvailability } from '@/hooks/useAvailabilityHold';
import {
  AVAILABILITY_PRESETS, DAY_LONG, DAY_SHORT, PROBLEM_TEXT, copyToDays, presetIntervals, sortIntervals, summarizeWeekly, validateWeekly,
  type PresetKey, type WeeklyInterval,
} from '@/lib/availabilityRules';

export const TIMEZONE_OPTIONS = [
  'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Africa/Cairo', 'Asia/Amman', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Istanbul', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Tokyo', 'Australia/Sydney',
];

const T = {
  en: {
    title: 'Weekly availability', intro: 'Choose your working days and hours. Clients and matching use them; requests outside them are not counted against you.',
    presets: 'Quick start', days: 'Working days', tz: 'Time zone', add: 'Add time', remove: 'Remove time', copy: 'Copy to all working days',
    from: 'From', to: 'To', save: 'Save availability', saving: 'Saving…', reset: 'Undo changes', saved: 'Weekly availability saved.',
    none: 'Choose at least one working day.', fix: 'Please fix the times marked in red.', summary: 'Summary',
  },
  ar: {
    title: 'التوفر الأسبوعي', intro: 'اختر أيام وساعات عملك. يعتمد عليها العملاء والمطابقة، والطلبات خارجها لا تُحتسب ضدك.',
    presets: 'بداية سريعة', days: 'أيام العمل', tz: 'المنطقة الزمنية', add: 'أضف وقتًا', remove: 'احذف الوقت', copy: 'انسخ إلى كل أيام العمل',
    from: 'من', to: 'إلى', save: 'احفظ التوفر', saving: 'جارٍ الحفظ…', reset: 'تراجع عن التغييرات', saved: 'تم حفظ التوفر الأسبوعي.',
    none: 'اختر يوم عمل واحدًا على الأقل.', fix: 'يرجى تصحيح الأوقات المحددة باللون الأحمر.', summary: 'الملخص',
  },
};

type Row = WeeklyInterval & { key: string };
let seq = 0;
const withKeys = (list: WeeklyInterval[]): Row[] => sortIntervals(list).map((s) => ({ ...s, key: `k${++seq}` }));
const strip = (rows: Row[]): WeeklyInterval[] => rows.map(({ day, start, end }) => ({ day, start, end }));
const same = (a: WeeklyInterval[], b: WeeklyInterval[]) => JSON.stringify(sortIntervals(a)) === JSON.stringify(sortIntervals(b));

/**
 * Feature Y: the simple weekly availability editor on the profile (day chips, times per day, copy to all working days,
 * presets, time zone, live summary, validated save). One-date slots stay in the calendar and are never touched here.
 */
export default function WeeklyAvailabilityEditor({ onSaved }: { onSaved?: () => void }) {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const s = T[lang];
  const q = useMyAvailability();
  const actions = useAvailabilityActions();
  const [rows, setRows] = useState<Row[]>([]);
  const [tz, setTz] = useState('Asia/Riyadh');
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const me = q.data;

  useEffect(() => {
    if (!me) return;
    setRows(withKeys(me.weekly));
    setTz(me.timezone || 'Asia/Riyadh');
    // Re-seed only when the saved data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.consultantId, JSON.stringify(me?.weekly), me?.timezone]);

  const list = strip(rows);
  const problems = useMemo(() => validateWeekly(list), [JSON.stringify(list)]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = [...new Set(list.map((r) => r.day))].sort();
  const dirty = !!me && (!same(list, me.weekly) || tz !== (me.timezone || 'Asia/Riyadh'));
  const summary = summarizeWeekly(list, tz, lang);

  const toggleDay = (day: number) => {
    if (days.includes(day)) { setRows((r) => r.filter((x) => x.day !== day)); return; }
    const model = list.filter((x) => x.day === days[0]);
    const add = model.length ? model.map((m) => ({ ...m, day })) : [{ day, start: '09:00', end: '17:00' }];
    setRows((r) => withKeys([...strip(r), ...add]));
  };
  const setTime = (key: string, field: 'start' | 'end', value: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: value } : x)));
  const addTime = (day: number) => {
    const last = sortIntervals(list.filter((x) => x.day === day)).pop();
    const start = last ? last.end : '09:00';
    const h = Math.min(23, Number(start.slice(0, 2)) + 2);
    setRows((r) => [...r, { day, start, end: `${String(h).padStart(2, '0')}:${start.slice(3, 5)}`, key: `k${++seq}` }]);
  };
  const removeTime = (key: string) => setRows((r) => r.filter((x) => x.key !== key));
  const copyAll = (day: number) => setRows(withKeys(copyToDays(list, day, days)));
  const preset = (k: PresetKey) => setRows(withKeys(presetIntervals(k)));

  const save = async () => {
    setTried(true);
    if (!me) return;
    if (!list.length) { toast.error(s.none); return; }
    if (problems.length) { toast.error(s.fix); return; }
    setSaving(true);
    try {
      await actions.saveWeekly(me, list, tz);
      toast.success(s.saved);
      setTried(false);
      onSaved?.();
    } catch (e) {
      toast.error((e as Error)?.message || 'Could not save your availability');
    } finally { setSaving(false); }
  };

  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />…</div>;
  if (!me) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5" data-testid="weekly-availability-editor" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <p className="text-sm text-muted-foreground">{s.intro}</p>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{s.presets}</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(AVAILABILITY_PRESETS) as PresetKey[]).map((k) => (
            <Button key={k} type="button" size="sm" variant="outline" onClick={() => preset(k)} data-testid={`preset-${k}`}>
              {AVAILABILITY_PRESETS[k].label[lang === 'ar' ? 1 : 0]}
            </Button>
          ))}
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-muted-foreground">{s.days}</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label={s.days}>
          {DAY_SHORT[lang].map((d, i) => {
            const on = days.includes(i);
            return (
              <button key={i} type="button" aria-pressed={on} aria-label={DAY_LONG[lang][i]} onClick={() => toggleDay(i)} data-testid={`day-chip-${i}`}
                className={cn('min-h-10 min-w-12 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted')}>
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>

      {days.length > 0 && (
        <ul className="space-y-2">
          {days.map((day) => {
            const items = rows.filter((r) => r.day === day).sort((a, b) => a.start.localeCompare(b.start));
            return (
              <li key={day} className="rounded-xl border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{DAY_LONG[lang][day]}</span>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => addTime(day)}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{s.add}</Button>
                    {days.length > 1 && <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => copyAll(day)} data-testid={`copy-${day}`}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{s.copy}</Button>}
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {items.map((r) => {
                    const idx = rows.indexOf(r);
                    const p = problems.find((x) => x.index === idx);
                    const errId = `avail-err-${r.key}`;
                    return (
                      <div key={r.key} className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`${r.key}-from`} className="text-xs">{s.from}</Label>
                          <Input id={`${r.key}-from`} type="time" value={r.start} onChange={(e) => setTime(r.key, 'start', e.target.value)} className="h-9 w-32"
                            aria-invalid={!!p} aria-describedby={p ? errId : undefined} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${r.key}-to`} className="text-xs">{s.to}</Label>
                          <Input id={`${r.key}-to`} type="time" value={r.end} onChange={(e) => setTime(r.key, 'end', e.target.value)} className="h-9 w-32"
                            aria-invalid={!!p} aria-describedby={p ? errId : undefined} />
                        </div>
                        <Button type="button" size="icon" variant="ghost" aria-label={`${s.remove} (${DAY_LONG[lang][day]} ${r.start}-${r.end})`} onClick={() => removeTime(r.key)} className="h-9 w-9">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {p && <p id={errId} role="alert" className="basis-full text-xs text-destructive">{PROBLEM_TEXT[p.code][lang === 'ar' ? 1 : 0]}</p>}
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {tried && !list.length && <p role="alert" className="text-xs text-destructive">{s.none}</p>}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="availability-tz" className="text-xs">{s.tz}</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger id="availability-tz" className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...new Set([tz, ...TIMEZONE_OPTIONS])].map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm font-medium text-foreground" aria-live="polite" data-testid="availability-summary">
          <span className="sr-only">{s.summary}: </span>{summary}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={!dirty || saving} data-testid="availability-save">
          {saving ? <><Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />{s.saving}</> : s.save}
        </Button>
        {dirty && <Button type="button" variant="outline" onClick={() => { setRows(withKeys(me.weekly)); setTz(me.timezone || 'Asia/Riyadh'); setTried(false); }}>{s.reset}</Button>}
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { Link2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { LIMITS, type BrdRequirementRef, type TraceRef } from '../../../../supabase/functions/_shared/archModel';

/** Requirement-to-design links of one section (BRD requirement ids of the linked tickets). */
export default function TracePicker({ value, requirements, onChange, readOnly }: {
  value: TraceRef[]; requirements: BrdRequirementRef[]; onChange?: (v: TraceRef[]) => void; readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const key = (r: TraceRef) => `${r.ticket_ref}|${r.req_id}`;
  const has = new Set(value.map(key));
  const toggle = (r: BrdRequirementRef) => {
    if (!onChange) return;
    const k = key(r);
    onChange(has.has(k) ? value.filter((x) => key(x) !== k) : value.length >= LIMITS.tracePerSection ? value : [...value, { ticket_ref: r.ticket_ref, req_id: r.req_id }]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((r) => {
        const known = requirements.some((q) => key(q) === key(r));
        return (
          <Badge key={key(r)} variant={known ? 'secondary' : 'outline'} className="gap-1 text-[10px]" title={requirements.find((q) => key(q) === key(r))?.description}>
            {r.ticket_ref} · {r.req_id}{!known && ` (${t('arch.trace.unknown')})`}
            {!readOnly && onChange && (
              <button type="button" aria-label={t('arch.trace.remove', { id: r.req_id })} onClick={() => onChange(value.filter((x) => key(x) !== key(r)))}><X className="h-3 w-3" /></button>
            )}
          </Badge>
        );
      })}
      {!readOnly && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"><Link2 className="h-3.5 w-3.5" /> {t('arch.trace.link')}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-h-72 overflow-y-auto p-2">
            {requirements.length === 0 ? <p className="text-xs text-muted-foreground p-2">{t('arch.trace.none')}</p> : (
              <ul className="space-y-1">
                {requirements.map((r) => (
                  <li key={key(r)}>
                    <label className="flex items-start gap-2 rounded-lg p-1.5 text-xs hover:bg-muted cursor-pointer">
                      <Checkbox checked={has.has(key(r))} onCheckedChange={() => toggle(r)} className="mt-0.5" />
                      <span><span className="font-mono font-medium">{r.ticket_ref} {r.req_id}</span> <span className="text-muted-foreground">{r.description}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

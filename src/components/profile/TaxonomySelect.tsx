// A single choice from grouped ready lists (src/lib/profileTaxonomy.ts). The first option is the "empty" choice; it gives ''.
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TaxonomyGroup } from '@/lib/profileTaxonomy';

const NONE = '__none__';

interface Props {
  groups: TaxonomyGroup[];
  value: string;
  onChange: (next: string) => void;
  /** Text of the empty choice, e.g. "Not specified" or "Any". */
  noneLabel: string;
  id?: string;
  className?: string;
  ariaLabel?: string;
}

export default function TaxonomySelect({ groups, value, onChange, noneLabel, id, className, ariaLabel }: Props) {
  const all = groups.flatMap(g => g.items);
  // A saved value that is not in the lists (an older value or typed "Other" text) stays selectable.
  const extra = value && !all.includes(value) ? value : null;
  return (
    <Select value={value || NONE} onValueChange={v => onChange(v === NONE ? '' : v)}>
      <SelectTrigger id={id} className={className ?? 'rounded-xl'} aria-label={ariaLabel}>
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {extra && <SelectItem value={extra}>{extra}</SelectItem>}
        {groups.map(g => (
          <SelectGroup key={g.group}>
            {groups.length > 1 && <SelectLabel>{g.group}</SelectLabel>}
            {g.items.map(item => (
              <SelectItem key={`${g.group}-${item}`} value={item}>{item}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

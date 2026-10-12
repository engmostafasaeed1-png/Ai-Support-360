import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { isOther, type TaxonomyGroup } from '@/lib/profileTaxonomy';

type Props = {
  groups: TaxonomyGroup[];
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  placeholder?: string;
  otherPlaceholder?: string;
};

/** Multi-select of grouped ready lists with search, removable badges and an "Other" free-text entry. */
export default function GroupedMultiSelect({ groups, value, onChange, max = 60, placeholder = 'Search…', otherPlaceholder = 'Other (type and press Add)' }: Props) {
  const [query, setQuery] = useState('');
  const [otherText, setOtherText] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const known = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const it of g.items) s.add(it.toLowerCase());
    return s;
  }, [groups]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const atMax = value.length >= max;

  const isOpen = (g: TaxonomyGroup) =>
    searching || (open[g.group] ?? g.items.some((it) => value.includes(it)));

  const visibleGroups = useMemo(() => {
    if (!searching) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => it.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, searching, q]);

  const toggle = (item: string, on: boolean) => {
    if (on) {
      if (value.includes(item) || atMax) return;
      onChange([...value, item]);
    } else {
      onChange(value.filter((v) => v !== item));
    }
  };

  const remove = (item: string) => onChange(value.filter((v) => v !== item));

  const addOther = () => {
    const text = otherText.trim().slice(0, 120);
    if (!text) return;
    if (value.some((v) => v.toLowerCase() === text.toLowerCase())) {
      setOtherText('');
      return;
    }
    if (atMax) return;
    onChange([...value, text]);
    setOtherText('');
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 py-1 ps-2.5 pe-1">
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => remove(v)} className="rounded-full p-0.5 hover:bg-muted">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="h-8 text-xs" aria-label={placeholder} />

      {atMax && <p className="text-xs text-muted-foreground">You can choose up to {max} entries.</p>}

      <div className="space-y-1">
        {visibleGroups.map((g) => {
          const selected = g.items.filter((it) => value.includes(it)).length;
          const expanded = isOpen(g);
          return (
            <div key={g.group} className="rounded-lg border border-border/60">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [g.group]: !expanded }))}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span>{g.group}</span>
                {selected > 0 && <span className="text-muted-foreground">· {selected} selected</span>}
              </button>
              {expanded && (
                <div className="max-h-64 overflow-y-auto border-t border-border/60 p-2 grid sm:grid-cols-2 gap-1">
                  {g.items.map((it) => {
                    if (isOther(it)) {
                      return (
                        <div key={it} className="flex gap-2 sm:col-span-2 px-1 py-1">
                          <Input
                            value={otherText}
                            onChange={(e) => setOtherText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } }}
                            placeholder={otherPlaceholder}
                            className="h-8 text-xs"
                            maxLength={120}
                            aria-label={otherPlaceholder}
                          />
                          <Button type="button" size="sm" variant="outline" className="h-8" onClick={addOther} disabled={!otherText.trim() || atMax}>
                            <Plus className="h-3.5 w-3.5 me-1" />Add
                          </Button>
                        </div>
                      );
                    }
                    const on = value.includes(it);
                    return (
                      <label key={it} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted cursor-pointer">
                        <Checkbox checked={on} disabled={!on && atMax} onCheckedChange={(v) => toggle(it, !!v)} />
                        {it}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {visibleGroups.length === 0 && <p className="text-xs text-muted-foreground px-1">No match.</p>}
      </div>
    </div>
  );
}

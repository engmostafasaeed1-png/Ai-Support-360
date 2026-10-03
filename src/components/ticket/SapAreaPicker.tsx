import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SAP_AREA_GROUPS,
  OTHER_AREA,
  MAX_SAP_AREAS,
  MAX_OTHER_AREA_LENGTH,
  MAX_AREA_DETAILS_LENGTH,
  filterAreaGroups,
  hasArea,
  isOtherArea,
  toggleArea,
  makeMainArea,
  areaLabel,
} from '@/lib/sapAreas';

interface SapAreaPickerProps {
  /** The chosen areas in the order chosen. The first one is the main area. */
  areas: string[];
  /** The name typed for "Other". */
  other: string;
  /** More details about the areas. */
  details: string;
  onAreasChange: (areas: string[]) => void;
  onOtherChange: (text: string) => void;
  onDetailsChange: (text: string) => void;
  areasError?: string;
  otherError?: string;
  detailsError?: string;
  idPrefix?: string;
}

export default function SapAreaPicker({
  areas,
  other,
  details,
  onAreasChange,
  onOtherChange,
  onDetailsChange,
  areasError,
  otherError,
  detailsError,
  idPrefix = 'sap-areas',
}: SapAreaPickerProps) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const searching = query.trim().length > 0;
  const groups = useMemo(() => filterAreaGroups(SAP_AREA_GROUPS, query), [query]);
  const otherSelected = areas.some(isOtherArea);
  const atLimit = areas.length >= MAX_SAP_AREAS;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Choose every SAP module or area your request touches. The first one is the main area; use the star on another one to make it the main area.
        </p>
        <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {areas.length} of {MAX_SAP_AREAS} chosen
        </span>
      </div>

      {areas.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Chosen SAP areas">
          {areas.map((name, i) => (
            <Badge
              key={name}
              role="listitem"
              variant="secondary"
              className="gap-1 ps-2 pe-1 py-1 text-xs border-accent/30 bg-accent/10 text-foreground"
            >
              {i === 0 && areas.length > 1 && <Star className="h-3 w-3 fill-accent text-accent" aria-label="Main area" />}
              <span>{areaLabel(name, other)}</span>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => onAreasChange(makeMainArea(areas, name))}
                  className="rounded p-0.5 text-muted-foreground hover:text-accent"
                  title="Make this the main area"
                  aria-label={`Make ${name} the main area`}
                >
                  <Star className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onAreasChange(areas.filter(x => x !== name))}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {areasError && <p className="text-[11px] text-destructive">{areasError}</p>}

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search all SAP modules and areas (for example: payroll, pricing, Fiori)"
          aria-label="Search SAP modules and areas"
          className="rounded-xl ps-9"
        />
      </div>

      <div className="space-y-1">
        {groups.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No SAP area matches your search. Choose "Other" below and name it.
          </p>
        )}
        {groups.map((g, idx) => {
          const isOpen = searching || (openGroups[g.id] ?? idx === 0);
          const selectedCount = g.areas.filter(area => hasArea(areas, area.name)).length;
          return (
            <Collapsible
              key={g.id}
              open={isOpen}
              onOpenChange={next => {
                if (!searching) setOpenGroups(prev => ({ ...prev, [g.id]: next }));
              }}
            >
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center gap-2 py-1.5 text-start">
                  <span className="text-sm font-semibold text-foreground">{g.label}</span>
                  <Badge variant="secondary" className="text-[10px]">{g.areas.length}</Badge>
                  {selectedCount > 0 && (
                    <Badge className="bg-accent text-[10px] text-accent-foreground">{selectedCount} chosen</Badge>
                  )}
                  <ChevronDown className={`ms-auto h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-1 gap-2 pb-2 pt-1 sm:grid-cols-2">
                  {g.areas.map(area => {
                    const selected = hasArea(areas, area.name);
                    const blocked = !selected && atLimit;
                    return (
                      <button
                        key={area.name}
                        type="button"
                        aria-pressed={selected}
                        disabled={blocked}
                        title={area.hint}
                        onClick={() => onAreasChange(toggleArea(areas, area.name))}
                        className={`flex items-start gap-2 rounded-xl border p-2.5 text-start text-sm transition-all ${
                          selected
                            ? 'border-accent bg-accent/10 font-medium text-foreground'
                            : 'border-border/50 text-muted-foreground hover:border-accent/30'
                        } ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border'
                          }`}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block leading-snug">{area.name}</span>
                          <span className="line-clamp-1 block text-[11px] font-normal text-muted-foreground">{area.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      {atLimit && (
        <p className="text-[11px] text-muted-foreground">You can choose {MAX_SAP_AREAS} areas at most. Remove one to choose another.</p>
      )}

      <div className="space-y-2 border-t border-border/50 pt-3">
        <button
          type="button"
          aria-pressed={otherSelected}
          disabled={!otherSelected && atLimit}
          onClick={() => onAreasChange(toggleArea(areas, OTHER_AREA))}
          className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-start text-sm transition-all ${
            otherSelected
              ? 'border-accent bg-accent/10 font-medium text-foreground'
              : 'border-border/50 text-muted-foreground hover:border-accent/30'
          } ${!otherSelected && atLimit ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
              otherSelected ? 'border-accent bg-accent text-accent-foreground' : 'border-border'
            }`}
          >
            {otherSelected && <Check className="h-3 w-3" />}
          </span>
          <span className="min-w-0">
            <span className="block leading-snug">Other</span>
            <span className="block text-[11px] font-normal text-muted-foreground">My area is not in the list: I will name it myself</span>
          </span>
        </button>
        {otherSelected && (
          <div>
            <label htmlFor={`${idPrefix}-other`} className="mb-1 block text-xs font-medium">
              Name the other SAP area
            </label>
            <Input
              id={`${idPrefix}-other`}
              value={other}
              onChange={e => onOtherChange(e.target.value)}
              maxLength={MAX_OTHER_AREA_LENGTH}
              placeholder="For example: cash application automation, a custom add-on, a third-party interface"
              className={`rounded-xl ${otherError ? 'border-destructive' : ''}`}
            />
            {otherError && <p className="mt-1 text-[11px] text-destructive">{otherError}</p>}
          </div>
        )}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-details`} className="mb-1.5 block text-sm font-medium">
          More details about these areas <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id={`${idPrefix}-details`}
          value={details}
          onChange={e => onDetailsChange(e.target.value)}
          maxLength={MAX_AREA_DETAILS_LENGTH}
          rows={3}
          placeholder="Which processes, systems, countries or company codes are involved? Anything the consultant should know about these areas."
          className={`rounded-xl ${detailsError ? 'border-destructive' : ''}`}
        />
        <div className="mt-1 flex items-center justify-between">
          {detailsError ? <p className="text-[11px] text-destructive">{detailsError}</p> : <span />}
          <span className="text-[11px] text-muted-foreground">{details.length}/{MAX_AREA_DETAILS_LENGTH}</span>
        </div>
      </div>
    </div>
  );
}

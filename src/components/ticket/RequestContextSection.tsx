// Optional matching context of a new request ("Help us find the right expert"). Collapsed by default.
import { useState } from 'react';
import { ChevronDown, ChevronUp, Target } from 'lucide-react';
import { Label } from '@/components/ui/label';
import TaxonomySelect from '@/components/profile/TaxonomySelect';
import GroupedMultiSelect from '@/components/profile/GroupedMultiSelect';
import {
  INDUSTRY_EXPERIENCE, CUSTOMER_SEGMENTS, LOCALIZATION_COUNTRIES, PROJECT_TYPE_OPTIONS,
  VERTICAL_SOLUTIONS, LOCALIZATION_SOLUTIONS,
} from '@/lib/profileTaxonomy';
import type { TicketContextInput } from '@/lib/ticketContext';

/** The old company industry keys that clearly name one of the new industry labels. */
const INDUSTRY_KEY_TO_LABEL: Record<string, string> = {
  petrochemical: 'Petrochemicals',
  banking: 'Banking - retail',
  telecom: 'Telecommunications',
  healthcare: 'Healthcare - hospitals & providers',
  government: 'Government - ministries & authorities',
  logistics: 'Logistics & freight',
  technology: 'IT services & software',
  manufacturing: 'Discrete manufacturing',
};

/** The industry label for a company industry (a key or already a label), or '' when it does not map to one. */
export function industryLabelFor(companyIndustry: string | null | undefined): string {
  if (!companyIndustry) return '';
  const all = INDUSTRY_EXPERIENCE.flatMap(g => g.items);
  if (all.includes(companyIndustry)) return companyIndustry;
  return INDUSTRY_KEY_TO_LABEL[companyIndustry] ?? '';
}

interface Props {
  value: TicketContextInput;
  onChange: (next: TicketContextInput) => void;
}

export default function RequestContextSection({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TicketContextInput>) => onChange({ ...value, ...patch });
  return (
    <div className="rounded-xl border border-border/50">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 p-3 text-start"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="flex items-center gap-2 text-sm font-medium"><Target className="w-4 h-4 text-accent" /> Help us find the right expert</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      <p className="px-3 pb-3 -mt-1 text-xs text-muted-foreground">Optional: the more you tell us, the better the match.</p>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="ctx-industry">Industry</Label>
            <TaxonomySelect id="ctx-industry" groups={INDUSTRY_EXPERIENCE} value={value.industry ?? ''} onChange={v => set({ industry: v })} noneLabel="Not specified" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctx-segment">Customer segment</Label>
            <TaxonomySelect id="ctx-segment" groups={CUSTOMER_SEGMENTS} value={value.customer_segment ?? ''} onChange={v => set({ customer_segment: v })} noneLabel="Not specified" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctx-country">Country of the SAP system</Label>
            <TaxonomySelect id="ctx-country" groups={LOCALIZATION_COUNTRIES} value={value.country ?? ''} onChange={v => set({ country: v })} noneLabel="Not specified" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctx-project">Project type</Label>
            <TaxonomySelect id="ctx-project" groups={[{ group: 'Project types', items: PROJECT_TYPE_OPTIONS }]} value={value.project_type ?? ''} onChange={v => set({ project_type: v })} noneLabel="Not specified" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Vertical solutions needed</Label>
            <GroupedMultiSelect groups={VERTICAL_SOLUTIONS} value={value.vertical_solutions ?? []} onChange={v => set({ vertical_solutions: v })} max={5} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Localization solutions needed</Label>
            <GroupedMultiSelect groups={LOCALIZATION_SOLUTIONS} value={value.localization_solutions ?? []} onChange={v => set({ localization_solutions: v })} max={5} />
          </div>
        </div>
      )}
    </div>
  );
}

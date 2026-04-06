import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Briefcase } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { OnboardingData, WorkHistoryEntry } from '../ConsultantOnboarding';

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

const emptyWork: WorkHistoryEntry = {
  companyName: '', jobTitle: '', startDate: '', endDate: '', description: '', isCurrent: false,
};

export default function WorkHistoryStep({ data, onChange }: Props) {
  const { t } = useTranslation();
  const items = data.workHistory || [];

  const update = (i: number, partial: Partial<WorkHistoryEntry>) => {
    const updated = items.map((item, idx) => idx === i ? { ...item, ...partial } : item);
    onChange({ workHistory: updated });
  };

  const add = () => onChange({ workHistory: [...items, { ...emptyWork }] });
  const remove = (i: number) => onChange({ workHistory: items.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Work Experience</h3>
        </div>
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No work experience added yet. Click "Add" to get started.
        </p>
      )}

      {items.map((item, i) => (
        <Card key={i} className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Company *</Label>
              <Input value={item.companyName} onChange={e => update(i, { companyName: e.target.value })} placeholder="Accenture" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Job Title *</Label>
              <Input value={item.jobTitle} onChange={e => update(i, { jobTitle: e.target.value })} placeholder="Senior SAP Consultant" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={item.startDate} onChange={e => update(i, { startDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End Date</Label>
              <Input type="date" value={item.endDate} onChange={e => update(i, { endDate: e.target.value })} disabled={item.isCurrent} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={item.isCurrent} onCheckedChange={v => update(i, { isCurrent: v, endDate: v ? '' : item.endDate })} />
            <Label className="text-xs">Currently working here</Label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea value={item.description} onChange={e => update(i, { description: e.target.value })} rows={2} placeholder="Key responsibilities..." />
          </div>
        </Card>
      ))}
    </div>
  );
}

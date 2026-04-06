import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, GraduationCap } from 'lucide-react';
import type { OnboardingData, EducationEntry } from '../ConsultantOnboarding';

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

const emptyEdu: EducationEntry = {
  institution: '', degree: '', fieldOfStudy: '', startYear: null, endYear: null,
};

export default function EducationStep({ data, onChange }: Props) {
  const { t } = useTranslation();
  const items = data.education || [];

  const update = (i: number, partial: Partial<EducationEntry>) => {
    const updated = items.map((item, idx) => idx === i ? { ...item, ...partial } : item);
    onChange({ education: updated });
  };

  const add = () => onChange({ education: [...items, { ...emptyEdu }] });
  const remove = (i: number) => onChange({ education: items.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Education</h3>
        </div>
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No education added yet. Click "Add" to get started.
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
              <Label className="text-xs">Institution *</Label>
              <Input value={item.institution} onChange={e => update(i, { institution: e.target.value })} placeholder="King Saud University" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Degree</Label>
              <Input value={item.degree} onChange={e => update(i, { degree: e.target.value })} placeholder="BSc / MSc / PhD" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Field of Study</Label>
              <Input value={item.fieldOfStudy} onChange={e => update(i, { fieldOfStudy: e.target.value })} placeholder="Computer Science" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Start Year</Label>
                <Input type="number" min={1970} max={2030} value={item.startYear || ''} onChange={e => update(i, { startYear: e.target.value ? Number(e.target.value) : null })} placeholder="2015" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Year</Label>
                <Input type="number" min={1970} max={2030} value={item.endYear || ''} onChange={e => update(i, { endYear: e.target.value ? Number(e.target.value) : null })} placeholder="2019" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

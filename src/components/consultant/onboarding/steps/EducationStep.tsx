import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, GraduationCap } from 'lucide-react';
import type { OnboardingData, EducationEntry } from '../ConsultantOnboarding';

const institutions = [
  'King Saud University', 'King Fahd University', 'KAUST',
  'King Abdulaziz University', 'Imam Muhammad Ibn Saud University',
  'Prince Sultan University', 'Effat University', 'Alfaisal University',
  'American University in Cairo', 'American University of Sharjah',
  'University of Dubai', 'Khalifa University', 'Qatar University',
  'Kuwait University', 'University of Bahrain', 'Sultan Qaboos University',
  'MIT', 'Stanford University', 'Harvard University', 'Carnegie Mellon',
  'University of Oxford', 'University of Cambridge', 'Imperial College London',
  'ETH Zurich', 'TU Munich', 'University of Melbourne',
  'IIT Bombay', 'IIT Delhi', 'NUS Singapore', 'University of Tokyo',
  'University of Toronto', 'McGill University',
  'Other',
];

const degrees = [
  'High School Diploma', 'Diploma', 'Associate Degree',
  'Bachelor of Science (BSc)', 'Bachelor of Arts (BA)',
  'Bachelor of Engineering (BEng)', 'Bachelor of Business (BBus)',
  'Master of Science (MSc)', 'Master of Arts (MA)',
  'Master of Engineering (MEng)', 'Master of Business Administration (MBA)',
  'Doctor of Philosophy (PhD)', 'Doctor of Engineering (DEng)',
  'Professional Certificate', 'Postgraduate Diploma',
  'Other',
];

const fieldsOfStudy = [
  'Computer Science', 'Information Technology', 'Information Systems',
  'Software Engineering', 'Computer Engineering', 'Data Science',
  'Artificial Intelligence', 'Cybersecurity',
  'Business Administration', 'Management', 'Finance', 'Accounting',
  'Economics', 'Marketing', 'Supply Chain Management',
  'Industrial Engineering', 'Mechanical Engineering', 'Electrical Engineering',
  'Chemical Engineering', 'Civil Engineering',
  'Mathematics', 'Statistics', 'Physics',
  'Other',
];

const years = Array.from({ length: 50 }, (_, i) => 2030 - i);

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
              <Select value={item.institution} onValueChange={v => update(i, { institution: v })}>
                <SelectTrigger><SelectValue placeholder="Select institution" /></SelectTrigger>
                <SelectContent>
                  {institutions.map(inst => (
                    <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Degree</Label>
              <Select value={item.degree} onValueChange={v => update(i, { degree: v })}>
                <SelectTrigger><SelectValue placeholder="Select degree" /></SelectTrigger>
                <SelectContent>
                  {degrees.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Field of Study</Label>
              <Select value={item.fieldOfStudy} onValueChange={v => update(i, { fieldOfStudy: v })}>
                <SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger>
                <SelectContent>
                  {fieldsOfStudy.map(f => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Start Year</Label>
                <Select value={item.startYear ? String(item.startYear) : ''} onValueChange={v => update(i, { startYear: Number(v) })}>
                  <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    {years.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Year</Label>
                <Select value={item.endYear ? String(item.endYear) : ''} onValueChange={v => update(i, { endYear: Number(v) })}>
                  <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    {years.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

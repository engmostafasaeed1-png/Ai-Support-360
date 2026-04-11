import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, FolderKanban, X } from 'lucide-react';
import { sapModules } from '@/data/clientMockData';
import type { OnboardingData, ProjectEntry } from '../ConsultantOnboarding';

const industries = [
  'Oil & Gas', 'Banking & Finance', 'Telecom', 'Retail & Consumer Goods',
  'Healthcare & Pharma', 'Government & Public Sector', 'Manufacturing',
  'Logistics & Transportation', 'Education', 'Real Estate & Construction',
  'Utilities & Energy', 'Mining & Metals', 'Automotive', 'Aerospace & Defense',
  'Media & Entertainment', 'Insurance', 'Agriculture', 'Other',
];

const roles = [
  'Lead Consultant', 'Senior Consultant', 'Consultant', 'Junior Consultant',
  'Solution Architect', 'Technical Architect', 'Project Manager', 'Program Manager',
  'Functional Analyst', 'Technical Lead', 'Developer', 'Integration Specialist',
  'Data Migration Lead', 'Test Lead', 'Change Manager', 'Business Analyst',
  'Subject Matter Expert', 'Trainer', 'Other',
];

const durations = [
  { value: 1, label: '< 1 month' },
  { value: 3, label: '1–3 months' },
  { value: 6, label: '3–6 months' },
  { value: 9, label: '6–9 months' },
  { value: 12, label: '9–12 months' },
  { value: 18, label: '12–18 months' },
  { value: 24, label: '18–24 months' },
  { value: 36, label: '2–3 years' },
  { value: 48, label: '3+ years' },
];

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

const emptyProject: ProjectEntry = {
  projectName: '', clientIndustry: '', sapModules: [], description: '', durationMonths: null, role: '',
};

export default function ProjectsStep({ data, onChange }: Props) {
  const { t } = useTranslation();
  const items = data.projects || [];

  const update = (i: number, partial: Partial<ProjectEntry>) => {
    const updated = items.map((item, idx) => idx === i ? { ...item, ...partial } : item);
    onChange({ projects: updated });
  };

  const add = () => onChange({ projects: [...items, { ...emptyProject }] });
  const remove = (i: number) => onChange({ projects: items.filter((_, idx) => idx !== i) });

  const toggleModule = (i: number, mod: string) => {
    const item = items[i];
    const mods = item.sapModules.includes(mod) ? item.sapModules.filter(m => m !== mod) : [...item.sapModules, mod];
    update(i, { sapModules: mods });
  };

  const projectTypes = [
    'S/4HANA Greenfield Implementation', 'S/4HANA Brownfield Migration',
    'System Upgrade', 'Module Implementation', 'Rollout / Template Deployment',
    'Integration Project', 'Data Migration', 'Support & Maintenance',
    'Business Process Reengineering', 'Cloud Migration (Rise with SAP)',
    'Custom Development', 'Performance Optimization', 'Security & GRC',
    'Training & Knowledge Transfer', 'Other',
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderKanban className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Project Portfolio</h3>
        </div>
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No projects added yet. Showcase your SAP implementation experience.
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
              <Label className="text-xs">Project Type *</Label>
              <Select value={item.projectName} onValueChange={v => update(i, { projectName: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {projectTypes.map(pt => (
                    <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Your Role</Label>
              <Select value={item.role} onValueChange={v => update(i, { role: v })}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Client Industry</Label>
              <Select value={item.clientIndustry} onValueChange={v => update(i, { clientIndustry: v })}>
                <SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger>
                <SelectContent>
                  {industries.map(ind => <SelectItem key={ind} value={ind}>{ind}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duration</Label>
              <Select value={item.durationMonths ? String(item.durationMonths) : ''} onValueChange={v => update(i, { durationMonths: Number(v) })}>
                <SelectTrigger><SelectValue placeholder="Select duration" /></SelectTrigger>
                <SelectContent>
                  {durations.map(d => (
                    <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SAP Modules Used</Label>
            <div className="flex flex-wrap gap-1.5">
              {sapModules.slice(0, 12).map(mod => (
                <Badge
                  key={mod}
                  variant={item.sapModules.includes(mod) ? 'default' : 'outline'}
                  className="cursor-pointer text-[10px]"
                  onClick={() => toggleModule(i, mod)}
                >
                  {mod}
                  {item.sapModules.includes(mod) && <X className="w-2.5 h-2.5 ms-1" />}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea value={item.description} onChange={e => update(i, { description: e.target.value })} rows={2} placeholder="What you achieved..." />
          </div>
        </Card>
      ))}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FolderKanban, Plus, Clock, Users, CalendarDays, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const projects = [
  {
    id: '1',
    title: 'SAP S/4HANA Migration',
    description: 'Full migration from SAP ECC to S/4HANA including data migration and cutover.',
    status: 'in_progress',
    progress: 65,
    consultant: 'Ahmed Al-Rashid',
    startDate: '2025-01-15',
    endDate: '2025-06-30',
    modules: ['SAP FI/CO', 'SAP MM', 'SAP SD'],
    milestones: { total: 8, completed: 5 },
  },
  {
    id: '2',
    title: 'SAP BW/4HANA Reporting',
    description: 'Implement new reporting dashboards and data warehouse optimization.',
    status: 'planning',
    progress: 15,
    consultant: 'Sara Mohammed',
    startDate: '2025-03-01',
    endDate: '2025-08-15',
    modules: ['SAP BW', 'SAP Analytics'],
    milestones: { total: 5, completed: 0 },
  },
  {
    id: '3',
    title: 'SuccessFactors Integration',
    description: 'Integrate SuccessFactors with existing SAP HCM for unified HR management.',
    status: 'completed',
    progress: 100,
    consultant: 'Omar Khaled',
    startDate: '2024-09-01',
    endDate: '2025-01-10',
    modules: ['SAP HCM', 'SuccessFactors'],
    milestones: { total: 6, completed: 6 },
  },
  {
    id: '4',
    title: 'SAP Fiori UX Redesign',
    description: 'Redesign and customize Fiori apps for improved user experience.',
    status: 'on_hold',
    progress: 40,
    consultant: 'Unassigned',
    startDate: '2025-02-01',
    endDate: '2025-07-01',
    modules: ['SAP Fiori', 'SAP UI5'],
    milestones: { total: 4, completed: 2 },
  },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
  in_progress: { label: 'In Progress', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  completed: { label: 'Completed', color: 'bg-muted text-muted-foreground border-border' },
  on_hold: { label: 'On Hold', color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
};

const stats = [
  { label: 'Active Projects', value: '2', color: 'text-primary' },
  { label: 'Completed', value: '1', color: 'text-emerald-500' },
  { label: 'On Hold', value: '1', color: 'text-amber-500' },
  { label: 'Total Milestones', value: '23', color: 'text-blue-500' },
];

export default function ProjectsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-primary" />
            {t('sidebar.projects', 'Projects')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track your active projects</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5">
          <Plus className="w-4 h-4" /> New Project
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="pt-5 pb-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4">
        {projects.map((project) => {
          const sc = statusConfig[project.status];
          return (
            <Card key={project.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{project.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${sc.color}`}>{sc.label}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {project.modules.map((m) => (
                        <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{project.progress}%</span>
                      </div>
                      <Progress value={project.progress} className="h-1.5" />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {project.consultant}</span>
                      <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {project.startDate} → {project.endDate}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {project.milestones.completed}/{project.milestones.total} milestones</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

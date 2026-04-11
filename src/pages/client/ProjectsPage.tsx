import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  FolderKanban, Plus, Clock, Users, CalendarDays, ChevronDown, ChevronRight,
  CheckCircle2, Circle, ListTodo, Activity, Ticket, Milestone as MilestoneIcon,
  AlertTriangle, Eye, Link2, ArrowRight
} from 'lucide-react';

/* ── Mock Data ── */
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
    milestones: [
      { id: 'm1', title: 'Discovery & Requirements', status: 'completed', dueDate: '2025-02-01', amount: 5000 },
      { id: 'm2', title: 'Data Migration Plan', status: 'completed', dueDate: '2025-03-01', amount: 8000 },
      { id: 'm3', title: 'System Configuration', status: 'in_progress', dueDate: '2025-04-15', amount: 12000 },
      { id: 'm4', title: 'UAT & Cutover', status: 'pending', dueDate: '2025-06-01', amount: 10000 },
    ],
    tasks: [
      { id: 't1', title: 'Configure GL accounts in S/4', status: 'done', priority: 'high', assignee: 'Ahmed' },
      { id: 't2', title: 'Map legacy cost centers', status: 'in_progress', priority: 'medium', assignee: 'Ahmed' },
      { id: 't3', title: 'Validate vendor master data', status: 'todo', priority: 'high', assignee: 'Unassigned' },
      { id: 't4', title: 'Test purchase order flow', status: 'todo', priority: 'urgent', assignee: 'Unassigned' },
    ],
    activities: [
      { id: 'a1', text: 'Ahmed completed GL account configuration', time: '2 hours ago', type: 'task' },
      { id: 'a2', text: 'Milestone "Data Migration Plan" approved', time: '1 day ago', type: 'milestone' },
      { id: 'a3', text: 'Ticket #1042 linked to project', time: '2 days ago', type: 'ticket' },
      { id: 'a4', text: 'System Configuration milestone started', time: '3 days ago', type: 'milestone' },
    ],
    tickets: [
      {
        id: 'tk1', title: 'FI/CO posting error after migration', status: 'in_progress', urgency: 'high',
        children: [
          { id: 'tk1-c1', title: 'GL reconciliation mismatch', status: 'in_progress', urgency: 'medium' },
          { id: 'tk1-c2', title: 'Cost center posting rule fix', status: 'resolved', urgency: 'low' },
        ],
      },
      {
        id: 'tk2', title: 'MM purchase order number range', status: 'new', urgency: 'medium',
        children: [],
      },
      {
        id: 'tk3', title: 'SD pricing condition mapping', status: 'under_review', urgency: 'low',
        children: [
          { id: 'tk3-c1', title: 'Discount condition type setup', status: 'new', urgency: 'low' },
        ],
      },
    ],
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
    milestones: [
      { id: 'm5', title: 'Requirements Workshop', status: 'in_progress', dueDate: '2025-03-20', amount: 3000 },
      { id: 'm6', title: 'Data Model Design', status: 'pending', dueDate: '2025-05-01', amount: 6000 },
    ],
    tasks: [
      { id: 't5', title: 'Define KPI catalog', status: 'in_progress', priority: 'high', assignee: 'Sara' },
      { id: 't6', title: 'Review existing BW queries', status: 'todo', priority: 'medium', assignee: 'Sara' },
    ],
    activities: [
      { id: 'a5', text: 'Sara started KPI catalog definition', time: '5 hours ago', type: 'task' },
      { id: 'a6', text: 'Project kickoff meeting completed', time: '1 day ago', type: 'milestone' },
    ],
    tickets: [],
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
    milestones: [
      { id: 'm7', title: 'API Integration', status: 'completed', dueDate: '2024-11-01', amount: 7000 },
      { id: 'm8', title: 'Go-Live', status: 'completed', dueDate: '2025-01-10', amount: 5000 },
    ],
    tasks: [],
    activities: [
      { id: 'a7', text: 'Project completed and closed', time: '3 months ago', type: 'milestone' },
    ],
    tickets: [],
  },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
  in_progress: { label: 'In Progress', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  completed: { label: 'Completed', color: 'bg-muted text-muted-foreground border-border' },
  on_hold: { label: 'On Hold', color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
};

const taskStatusIcon: Record<string, React.ReactNode> = {
  todo: <Circle className="w-3.5 h-3.5 text-muted-foreground" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-blue-500" />,
  in_review: <Eye className="w-3.5 h-3.5 text-amber-500" />,
  done: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
};

const priorityBadge: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-500/10 text-blue-600',
  high: 'bg-amber-500/10 text-amber-600',
  urgent: 'bg-destructive/10 text-destructive',
};

const urgencyDot: Record<string, string> = {
  low: 'bg-muted-foreground',
  medium: 'bg-blue-500',
  high: 'bg-amber-500',
  critical: 'bg-destructive',
};

const milestoneStatusIcon: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  in_progress: <Clock className="w-4 h-4 text-blue-500" />,
  pending: <Circle className="w-4 h-4 text-muted-foreground" />,
};

const stats = [
  { label: 'Active Projects', value: '2', color: 'text-primary' },
  { label: 'Completed', value: '1', color: 'text-emerald-500' },
  { label: 'Total Tasks', value: '6', color: 'text-amber-500' },
  { label: 'Open Tickets', value: '3', color: 'text-blue-500' },
];

/* ── Component ── */
export default function ProjectsPage() {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>('1');

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Stats */}
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

      {/* Project Cards */}
      <div className="grid gap-4">
        {projects.map((project) => {
          const sc = statusConfig[project.status];
          const isOpen = expandedId === project.id;

          return (
            <Collapsible key={project.id} open={isOpen} onOpenChange={(o) => setExpandedId(o ? project.id : null)}>
              <Card className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CollapsibleTrigger asChild>
                  <CardContent className="p-5 cursor-pointer">
                    <div className="flex flex-col md:flex-row md:items-start gap-4">
                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                            <div>
                              <h3 className="font-semibold text-foreground">{project.title}</h3>
                              <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className={`shrink-0 text-[10px] ${sc.color}`}>{sc.label}</Badge>
                        </div>

                        <div className="flex flex-wrap gap-1.5 ml-6">
                          {project.modules.map((m) => (
                            <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                          ))}
                        </div>

                        <div className="space-y-1.5 ml-6">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Progress</span>
                            <span className="font-medium">{project.progress}%</span>
                          </div>
                          <Progress value={project.progress} className="h-1.5" />
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground ml-6">
                          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {project.consultant}</span>
                          <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {project.startDate} → {project.endDate}</span>
                          <span className="flex items-center gap-1"><MilestoneIcon className="w-3.5 h-3.5" /> {project.milestones.filter(m => m.status === 'completed').length}/{project.milestones.length} milestones</span>
                          <span className="flex items-center gap-1"><ListTodo className="w-3.5 h-3.5" /> {project.tasks.filter(t => t.status === 'done').length}/{project.tasks.length} tasks</span>
                          {project.tickets.length > 0 && (
                            <span className="flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> {project.tickets.length} tickets</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="px-5 pb-5 border-t border-border/50 pt-4">
                    <Tabs defaultValue="tasks" className="w-full">
                      <TabsList className="w-full justify-start bg-muted/50 mb-4">
                        <TabsTrigger value="tasks" className="gap-1.5 text-xs"><ListTodo className="w-3.5 h-3.5" /> Tasks ({project.tasks.length})</TabsTrigger>
                        <TabsTrigger value="tickets" className="gap-1.5 text-xs"><Ticket className="w-3.5 h-3.5" /> Tickets ({project.tickets.length})</TabsTrigger>
                        <TabsTrigger value="milestones" className="gap-1.5 text-xs"><MilestoneIcon className="w-3.5 h-3.5" /> Milestones ({project.milestones.length})</TabsTrigger>
                        <TabsTrigger value="activity" className="gap-1.5 text-xs"><Activity className="w-3.5 h-3.5" /> Activity</TabsTrigger>
                      </TabsList>

                      {/* Tasks Tab */}
                      <TabsContent value="tasks" className="space-y-2 mt-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">{project.tasks.filter(t => t.status === 'done').length} of {project.tasks.length} completed</p>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Plus className="w-3 h-3" /> Add Task</Button>
                        </div>
                        {project.tasks.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">No tasks yet</p>
                        ) : (
                          <div className="space-y-1.5">
                            {project.tasks.map(task => (
                              <div key={task.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                {taskStatusIcon[task.status]}
                                <span className="text-sm flex-1 truncate">{task.title}</span>
                                <Badge variant="outline" className={`text-[10px] ${priorityBadge[task.priority]}`}>{task.priority}</Badge>
                                <span className="text-xs text-muted-foreground hidden sm:inline">{task.assignee}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      {/* Tickets Tab */}
                      <TabsContent value="tickets" className="space-y-2 mt-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">{project.tickets.length} tickets assigned</p>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Link2 className="w-3 h-3" /> Assign Ticket</Button>
                        </div>
                        {project.tickets.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">No tickets assigned to this project</p>
                        ) : (
                          <div className="space-y-2">
                            {project.tickets.map(ticket => (
                              <div key={ticket.id} className="rounded-lg border border-border/50 overflow-hidden">
                                <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/20">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${urgencyDot[ticket.urgency]}`} />
                                  <span className="text-sm font-medium flex-1 truncate">{ticket.title}</span>
                                  <Badge variant="outline" className="text-[10px]">{ticket.status.replace('_', ' ')}</Badge>
                                </div>
                                {ticket.children.length > 0 && (
                                  <div className="bg-muted/10 border-t border-border/30">
                                    {ticket.children.map(child => (
                                      <div key={child.id} className="flex items-center gap-3 px-3 py-2 pl-8 text-xs border-b border-border/20 last:border-0">
                                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyDot[child.urgency]}`} />
                                        <span className="flex-1 truncate text-muted-foreground">{child.title}</span>
                                        <Badge variant="outline" className="text-[9px]">{child.status.replace('_', ' ')}</Badge>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      {/* Milestones Tab */}
                      <TabsContent value="milestones" className="space-y-2 mt-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">{project.milestones.filter(m => m.status === 'completed').length} of {project.milestones.length} completed</p>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Plus className="w-3 h-3" /> Add Milestone</Button>
                        </div>
                        <div className="space-y-1.5">
                          {project.milestones.map((ms, idx) => (
                            <div key={ms.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                              {milestoneStatusIcon[ms.status]}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{ms.title}</p>
                                <p className="text-xs text-muted-foreground">Due {ms.dueDate}</p>
                              </div>
                              <span className="text-sm font-semibold text-foreground">${ms.amount.toLocaleString()}</span>
                              <Badge variant="outline" className="text-[10px] capitalize">{ms.status.replace('_', ' ')}</Badge>
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      {/* Activity Tab */}
                      <TabsContent value="activity" className="space-y-0 mt-0">
                        {project.activities.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
                        ) : (
                          <div className="relative pl-4 border-l-2 border-border/50 space-y-4 ml-2">
                            {project.activities.map(act => (
                              <div key={act.id} className="relative">
                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background" />
                                <p className="text-sm">{act.text}</p>
                                <p className="text-xs text-muted-foreground">{act.time}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

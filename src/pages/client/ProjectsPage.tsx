import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  FolderKanban, Plus, Clock, Users, CalendarDays, ChevronDown, ChevronRight,
  CheckCircle2, Circle, ListTodo, Activity, Ticket, Milestone as MilestoneIcon,
  Eye, Link2, ArrowRight, Search, X, DollarSign, FileText, AlertTriangle,
  BarChart3, ClipboardCheck, UserCheck, RefreshCw
} from 'lucide-react';

/* ── Types ── */
interface ProjectTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assignees: string[];
  planned_hours?: number;
  actual_hours?: number;
  due_date?: string;
  consultant_updates?: { consultant: string; hours: number; notes: string; date: string }[];
}

interface ProjectTicket {
  id: string;
  title: string;
  status: string;
  urgency: string;
  children: { id: string; title: string; status: string; urgency: string }[];
}

interface ProjectMilestone {
  id: string;
  title: string;
  status: string;
  dueDate: string;
  amount: number;
  actual_amount?: number;
  approved?: boolean;
  deliverables?: string;
}

interface ProjectActivity {
  id: string;
  text: string;
  time: string;
  type: string;
}

interface Project {
  id: string;
  title: string;
  description: string;
  status: string;
  progress: number;
  consultant: string;
  startDate: string;
  endDate: string;
  modules: string[];
  milestones: ProjectMilestone[];
  tasks: ProjectTask[];
  activities: ProjectActivity[];
  tickets: ProjectTicket[];
  budget: number;
  actual_spend: number;
  planned_hours: number;
  actual_hours: number;
  currency: string;
}

interface ClientTicketRow {
  id: string;
  title: string;
  status: string;
  urgency: string;
  sap_module: string;
}

/* ── Initial Data ── */
const initialProjects: Project[] = [
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
    budget: 35000,
    actual_spend: 21500,
    planned_hours: 480,
    actual_hours: 312,
    currency: 'USD',
    milestones: [
      { id: 'm1', title: 'Discovery & Requirements', status: 'completed', dueDate: '2025-02-01', amount: 5000, actual_amount: 4800, approved: true, deliverables: 'Requirements document, Gap analysis report' },
      { id: 'm2', title: 'Data Migration Plan', status: 'completed', dueDate: '2025-03-01', amount: 8000, actual_amount: 8200, approved: true, deliverables: 'Migration strategy, Data mapping sheets' },
      { id: 'm3', title: 'System Configuration', status: 'in_progress', dueDate: '2025-04-15', amount: 12000, deliverables: 'Configured S/4 system, Unit test results' },
      { id: 'm4', title: 'UAT & Cutover', status: 'pending', dueDate: '2025-06-01', amount: 10000, deliverables: 'UAT sign-off, Go-live checklist' },
    ],
    tasks: [
      { id: 't1', title: 'Configure GL accounts in S/4', status: 'done', priority: 'high', assignees: ['Ahmed Al-Rashid'], planned_hours: 24, actual_hours: 22, due_date: '2025-03-10', consultant_updates: [{ consultant: 'Ahmed Al-Rashid', hours: 22, notes: 'Completed GL configuration and testing', date: '2025-03-09' }] },
      { id: 't2', title: 'Map legacy cost centers', status: 'in_progress', priority: 'medium', assignees: ['Ahmed Al-Rashid'], planned_hours: 16, actual_hours: 10, due_date: '2025-04-01', consultant_updates: [{ consultant: 'Ahmed Al-Rashid', hours: 10, notes: 'Mapping 60% done, pending validation', date: '2025-03-28' }] },
      { id: 't3', title: 'Validate vendor master data', status: 'todo', priority: 'high', assignees: [], planned_hours: 20, due_date: '2025-04-10' },
      { id: 't4', title: 'Test purchase order flow', status: 'todo', priority: 'urgent', assignees: [], planned_hours: 12, due_date: '2025-04-15' },
    ],
    activities: [
      { id: 'a1', text: 'Ahmed updated actuals: 10h on "Map legacy cost centers"', time: '2 hours ago', type: 'update' },
      { id: 'a2', text: 'Ahmed completed GL account configuration (22h actual vs 24h planned)', time: '1 day ago', type: 'task' },
      { id: 'a3', text: 'Milestone "Data Migration Plan" approved — $8,200 actual', time: '3 days ago', type: 'milestone' },
      { id: 'a4', text: 'Ticket #1042 linked to project', time: '5 days ago', type: 'ticket' },
    ],
    tickets: [
      {
        id: 'tk1', title: 'FI/CO posting error after migration', status: 'in_progress', urgency: 'high',
        children: [
          { id: 'tk1-c1', title: 'GL reconciliation mismatch', status: 'in_progress', urgency: 'medium' },
          { id: 'tk1-c2', title: 'Cost center posting rule fix', status: 'resolved', urgency: 'low' },
        ],
      },
      { id: 'tk2', title: 'MM purchase order number range', status: 'new', urgency: 'medium', children: [] },
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
    budget: 15000,
    actual_spend: 3000,
    planned_hours: 200,
    actual_hours: 30,
    currency: 'USD',
    milestones: [
      { id: 'm5', title: 'Requirements Workshop', status: 'in_progress', dueDate: '2025-03-20', amount: 3000, deliverables: 'KPI catalog, Report specifications' },
      { id: 'm6', title: 'Data Model Design', status: 'pending', dueDate: '2025-05-01', amount: 6000, deliverables: 'Data model, ETL design' },
    ],
    tasks: [
      { id: 't5', title: 'Define KPI catalog', status: 'in_progress', priority: 'high', assignees: ['Sara Mohammed'], planned_hours: 16, actual_hours: 8, due_date: '2025-03-18' },
      { id: 't6', title: 'Review existing BW queries', status: 'todo', priority: 'medium', assignees: ['Sara Mohammed'], planned_hours: 12, due_date: '2025-03-25' },
    ],
    activities: [
      { id: 'a5', text: 'Sara logged 8h on "Define KPI catalog"', time: '5 hours ago', type: 'update' },
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
    budget: 12000,
    actual_spend: 11800,
    planned_hours: 160,
    actual_hours: 155,
    currency: 'USD',
    milestones: [
      { id: 'm7', title: 'API Integration', status: 'completed', dueDate: '2024-11-01', amount: 7000, actual_amount: 7000, approved: true },
      { id: 'm8', title: 'Go-Live', status: 'completed', dueDate: '2025-01-10', amount: 5000, actual_amount: 4800, approved: true },
    ],
    tasks: [],
    activities: [{ id: 'a7', text: 'Project completed and closed — $11,800 total spend', time: '3 months ago', type: 'milestone' }],
    tickets: [],
  },
];

const availableConsultants = [
  'Ahmed Al-Rashid', 'Sara Mohammed', 'Omar Khaled',
  'Fatima Hassan', 'Khalid Ibrahim', 'Noura Al-Salem',
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

/* ── Component ── */
export default function ProjectsPage() {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>('1');
  const [projects, setProjects] = useState<Project[]>(initialProjects);

  // Add Task dialog
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addTaskProjectId, setAddTaskProjectId] = useState('');
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', planned_hours: '', due_date: '' });
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);

  // Assign Ticket dialog
  const [assignTicketOpen, setAssignTicketOpen] = useState(false);
  const [assignTicketProjectId, setAssignTicketProjectId] = useState('');
  const [clientTickets, setClientTickets] = useState<ClientTicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [ticketSearch, setTicketSearch] = useState('');

  // Enter Actuals dialog
  const [actualsOpen, setActualsOpen] = useState(false);
  const [actualsTask, setActualsTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const [actualsForm, setActualsForm] = useState({ hours: '', notes: '', status: '' });

  // Confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);

  // Task detail dialog
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [taskDetail, setTaskDetail] = useState<{ project: Project; task: ProjectTask } | null>(null);

  // Milestone detail dialog
  const [milestoneDetailOpen, setMilestoneDetailOpen] = useState(false);
  const [milestoneDetail, setMilestoneDetail] = useState<{ projectId: string; milestone: ProjectMilestone } | null>(null);
  const [milestoneActual, setMilestoneActual] = useState('');

  // Fetch client tickets
  useEffect(() => {
    if (!assignTicketOpen) return;
    const fetchTickets = async () => {
      setTicketsLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('tickets')
          .select('id, title, status, urgency, sap_module')
          .eq('client_id', user.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setClientTickets((data || []).map(t => ({
          ...t,
          status: t.status || 'new',
          urgency: t.urgency || 'medium',
          sap_module: t.sap_module || '',
        })));
      } catch {
        setClientTickets([]);
      } finally {
        setTicketsLoading(false);
      }
    };
    fetchTickets();
  }, [assignTicketOpen]);

  const toggleAssignee = (name: string) => {
    setSelectedAssignees(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const toggleTicketSelection = (id: string) => {
    setSelectedTicketIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmAction({ title, description, onConfirm });
    setConfirmOpen(true);
  };

  const handleAddTask = () => {
    if (!newTask.title.trim()) { toast.error('Task title is required'); return; }
    showConfirm('Add Task', `Add task "${newTask.title}" to the project?`, () => {
      setProjects(prev => prev.map(p => {
        if (p.id !== addTaskProjectId) return p;
        const task: ProjectTask = {
          id: `t-${Date.now()}`,
          title: newTask.title.trim(),
          description: newTask.description,
          status: 'todo',
          priority: newTask.priority,
          assignees: [...selectedAssignees],
          planned_hours: newTask.planned_hours ? Number(newTask.planned_hours) : undefined,
          due_date: newTask.due_date || undefined,
        };
        const assigneeText = task.assignees.length > 0 ? ` → ${task.assignees.join(', ')}` : '';
        return {
          ...p,
          tasks: [...p.tasks, task],
          planned_hours: p.planned_hours + (task.planned_hours || 0),
          activities: [{ id: `a-${Date.now()}`, text: `Task "${task.title}" added${assigneeText}`, time: 'Just now', type: 'task' }, ...p.activities],
        };
      }));
      setNewTask({ title: '', description: '', priority: 'medium', planned_hours: '', due_date: '' });
      setSelectedAssignees([]);
      setAddTaskOpen(false);
      toast.success('Task added successfully');
    });
  };

  const handleAssignTickets = () => {
    const project = projects.find(p => p.id === assignTicketProjectId);
    const alreadyAssigned = new Set(project?.tickets.map(t => t.id) || []);
    const ticketsToAdd = clientTickets.filter(t => selectedTicketIds.includes(t.id) && !alreadyAssigned.has(t.id));
    if (ticketsToAdd.length === 0) { toast.error('No new tickets selected'); return; }

    showConfirm('Assign Tickets', `Assign ${ticketsToAdd.length} ticket(s) to "${project?.title}"?`, () => {
      setProjects(prev => prev.map(p => {
        if (p.id !== assignTicketProjectId) return p;
        const newTickets: ProjectTicket[] = ticketsToAdd.map(t => ({
          id: t.id, title: t.title, status: t.status, urgency: t.urgency, children: [],
        }));
        return {
          ...p,
          tickets: [...p.tickets, ...newTickets],
          activities: [{ id: `a-${Date.now()}`, text: `${newTickets.length} ticket(s) assigned to project`, time: 'Just now', type: 'ticket' }, ...p.activities],
        };
      }));
      setSelectedTicketIds([]);
      setAssignTicketOpen(false);
      toast.success(`${ticketsToAdd.length} ticket(s) assigned`);
    });
  };

  const handleEnterActuals = () => {
    if (!actualsTask || !actualsForm.hours) { toast.error('Hours are required'); return; }
    const hours = Number(actualsForm.hours);
    if (isNaN(hours) || hours <= 0) { toast.error('Enter valid hours'); return; }

    setProjects(prev => prev.map(p => {
      if (p.id !== actualsTask.projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== actualsTask.taskId) return t;
          const update = { consultant: t.assignees[0] || 'Client', hours, notes: actualsForm.notes, date: new Date().toISOString().split('T')[0] };
          return {
            ...t,
            actual_hours: (t.actual_hours || 0) + hours,
            status: actualsForm.status || t.status,
            consultant_updates: [...(t.consultant_updates || []), update],
          };
        }),
        actual_hours: p.actual_hours + hours,
        actual_spend: p.actual_spend + hours * 75,
        activities: [
          { id: `a-${Date.now()}`, text: `Actuals entered: ${hours}h on "${p.tasks.find(t => t.id === actualsTask.taskId)?.title}"${actualsForm.notes ? ` — ${actualsForm.notes}` : ''}`, time: 'Just now', type: 'update' },
          ...p.activities,
        ],
      };
    }));
    setActualsForm({ hours: '', notes: '', status: '' });
    setActualsOpen(false);
    toast.success('Actuals recorded');
  };

  const handleApproveMilestone = (projectId: string, milestoneId: string) => {
    showConfirm('Approve Milestone', 'Approve this milestone and confirm completion?', () => {
      setProjects(prev => prev.map(p => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          milestones: p.milestones.map(m => m.id === milestoneId ? { ...m, approved: true, status: 'completed', actual_amount: m.actual_amount || m.amount } : m),
          activities: [{ id: `a-${Date.now()}`, text: `Milestone "${p.milestones.find(m => m.id === milestoneId)?.title}" approved`, time: 'Just now', type: 'milestone' }, ...p.activities],
        };
      }));
      toast.success('Milestone approved');
    });
  };

  const handleSaveMilestoneActual = () => {
    if (!milestoneDetail || !milestoneActual) return;
    setProjects(prev => prev.map(p => {
      if (p.id !== milestoneDetail.projectId) return p;
      return {
        ...p,
        milestones: p.milestones.map(m => m.id === milestoneDetail.milestone.id ? { ...m, actual_amount: Number(milestoneActual) } : m),
      };
    }));
    setMilestoneDetailOpen(false);
    toast.success('Milestone actual saved');
  };

  const totalTasks = projects.reduce((s, p) => s + p.tasks.length, 0);
  const totalTickets = projects.reduce((s, p) => s + p.tickets.length, 0);
  const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
  const totalSpend = projects.reduce((s, p) => s + p.actual_spend, 0);

  const stats = [
    { label: 'Active Projects', value: String(projects.filter(p => p.status === 'in_progress' || p.status === 'planning').length), color: 'text-primary', icon: FolderKanban },
    { label: 'Total Budget', value: `$${(totalBudget / 1000).toFixed(0)}K`, color: 'text-emerald-500', icon: DollarSign },
    { label: 'Actual Spend', value: `$${(totalSpend / 1000).toFixed(1)}K`, color: 'text-amber-500', icon: BarChart3 },
    { label: 'Tasks / Tickets', value: `${totalTasks} / ${totalTickets}`, color: 'text-blue-500', icon: ListTodo },
  ];

  const filteredClientTickets = clientTickets.filter(t =>
    t.title.toLowerCase().includes(ticketSearch.toLowerCase()) ||
    t.sap_module.toLowerCase().includes(ticketSearch.toLowerCase())
  );

  const currentProjectTicketIds = new Set(
    projects.find(p => p.id === assignTicketProjectId)?.tickets.map(t => t.id) || []
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-primary" />
            {t('sidebar.projects', 'Projects')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage, track progress, and enter actuals</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5">
          <Plus className="w-4 h-4" /> New Project
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <div className={`p-2 rounded-xl bg-muted/50`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Project Cards */}
      <div className="grid gap-4">
        {projects.map((project) => {
          const sc = statusConfig[project.status];
          const isOpen = expandedId === project.id;
          const budgetPercent = project.budget > 0 ? Math.round((project.actual_spend / project.budget) * 100) : 0;
          const hoursPercent = project.planned_hours > 0 ? Math.round((project.actual_hours / project.planned_hours) * 100) : 0;

          return (
            <Collapsible key={project.id} open={isOpen} onOpenChange={(o) => setExpandedId(o ? project.id : null)}>
              <Card className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
                <CollapsibleTrigger asChild>
                  <CardContent className="p-5 cursor-pointer">
                    <div className="flex flex-col gap-4">
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

                      {/* Budget & Hours Summary */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-6">
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Budget</p>
                          <p className="text-sm font-semibold">${project.budget.toLocaleString()}</p>
                          <Progress value={budgetPercent} className="h-1" />
                          <p className="text-[10px] text-muted-foreground">${project.actual_spend.toLocaleString()} spent ({budgetPercent}%)</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Hours</p>
                          <p className="text-sm font-semibold">{project.planned_hours}h planned</p>
                          <Progress value={hoursPercent} className="h-1" />
                          <p className="text-[10px] text-muted-foreground">{project.actual_hours}h actual ({hoursPercent}%)</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Progress</p>
                          <p className="text-sm font-semibold">{project.progress}%</p>
                          <Progress value={project.progress} className="h-1" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Timeline</p>
                          <p className="text-xs font-medium">{project.startDate}</p>
                          <p className="text-[10px] text-muted-foreground">→ {project.endDate}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground ml-6">
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {project.consultant}</span>
                        <span className="flex items-center gap-1"><MilestoneIcon className="w-3.5 h-3.5" /> {project.milestones.filter(m => m.status === 'completed').length}/{project.milestones.length} milestones</span>
                        <span className="flex items-center gap-1"><ListTodo className="w-3.5 h-3.5" /> {project.tasks.filter(t => t.status === 'done').length}/{project.tasks.length} tasks</span>
                        {project.tickets.length > 0 && (
                          <span className="flex items-center gap-1"><Ticket className="w-3.5 h-3.5" /> {project.tickets.length} tickets</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="px-5 pb-5 border-t border-border/50 pt-4">
                    <Tabs defaultValue="tasks" className="w-full">
                      <TabsList className="w-full justify-start bg-muted/50 mb-4 flex-wrap h-auto gap-1 p-1">
                        <TabsTrigger value="tasks" className="gap-1.5 text-xs"><ListTodo className="w-3.5 h-3.5" /> Tasks ({project.tasks.length})</TabsTrigger>
                        <TabsTrigger value="tickets" className="gap-1.5 text-xs"><Ticket className="w-3.5 h-3.5" /> Tickets ({project.tickets.length})</TabsTrigger>
                        <TabsTrigger value="milestones" className="gap-1.5 text-xs"><MilestoneIcon className="w-3.5 h-3.5" /> Milestones ({project.milestones.length})</TabsTrigger>
                        <TabsTrigger value="consultants" className="gap-1.5 text-xs"><UserCheck className="w-3.5 h-3.5" /> Consultants</TabsTrigger>
                        <TabsTrigger value="activity" className="gap-1.5 text-xs"><Activity className="w-3.5 h-3.5" /> Activity</TabsTrigger>
                      </TabsList>

                      {/* Tasks Tab */}
                      <TabsContent value="tasks" className="space-y-2 mt-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">{project.tasks.filter(t => t.status === 'done').length} of {project.tasks.length} completed • {project.tasks.reduce((s, t) => s + (t.actual_hours || 0), 0)}h / {project.tasks.reduce((s, t) => s + (t.planned_hours || 0), 0)}h logged</p>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                            onClick={(e) => { e.stopPropagation(); setAddTaskProjectId(project.id); setSelectedAssignees([]); setNewTask({ title: '', description: '', priority: 'medium', planned_hours: '', due_date: '' }); setAddTaskOpen(true); }}>
                            <Plus className="w-3 h-3" /> Add Task
                          </Button>
                        </div>
                        {project.tasks.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">No tasks yet</p>
                        ) : (
                          <div className="space-y-1.5">
                            {project.tasks.map(task => (
                              <div key={task.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group">
                                {taskStatusIcon[task.status]}
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setTaskDetail({ project, task }); setTaskDetailOpen(true); }}>
                                  <p className="text-sm truncate">{task.title}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    {task.planned_hours && <span>{task.actual_hours || 0}h / {task.planned_hours}h</span>}
                                    {task.due_date && <span>Due {task.due_date}</span>}
                                  </div>
                                </div>
                                <Badge variant="outline" className={`text-[10px] ${priorityBadge[task.priority]}`}>{task.priority}</Badge>
                                <div className="hidden sm:flex items-center gap-1">
                                  {task.assignees.length === 0 ? (
                                    <span className="text-xs text-muted-foreground">Unassigned</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {task.assignees.map(a => (
                                        <Badge key={a} variant="secondary" className="text-[9px] px-1.5 py-0">{a.split(' ')[0]}</Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {/* Enter Actuals button */}
                                {task.status !== 'done' && (
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActualsTask({ projectId: project.id, taskId: task.id });
                                      setActualsForm({ hours: '', notes: '', status: task.status });
                                      setActualsOpen(true);
                                    }}>
                                    <ClipboardCheck className="w-3 h-3" /> Actuals
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      {/* Tickets Tab */}
                      <TabsContent value="tickets" className="space-y-2 mt-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">{project.tickets.length} tickets assigned</p>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                            onClick={(e) => { e.stopPropagation(); setAssignTicketProjectId(project.id); setSelectedTicketIds([]); setTicketSearch(''); setAssignTicketOpen(true); }}>
                            <Link2 className="w-3 h-3" /> Assign Ticket
                          </Button>
                        </div>
                        {project.tickets.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">No tickets assigned to this project</p>
                        ) : (
                          <div className="space-y-2">
                            {project.tickets.map(ticket => (
                              <div key={ticket.id} className="rounded-lg border border-border/50 overflow-hidden">
                                <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/20">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${urgencyDot[ticket.urgency] || 'bg-muted-foreground'}`} />
                                  <span className="text-sm font-medium flex-1 truncate">{ticket.title}</span>
                                  <Badge variant="outline" className="text-[10px]">{ticket.status.replace('_', ' ')}</Badge>
                                </div>
                                {ticket.children.length > 0 && (
                                  <div className="bg-muted/10 border-t border-border/30">
                                    {ticket.children.map(child => (
                                      <div key={child.id} className="flex items-center gap-3 px-3 py-2 pl-8 text-xs border-b border-border/20 last:border-0">
                                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyDot[child.urgency] || 'bg-muted-foreground'}`} />
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
                          <p className="text-xs text-muted-foreground">{project.milestones.filter(m => m.status === 'completed').length} of {project.milestones.length} completed • ${project.milestones.reduce((s, m) => s + (m.actual_amount || 0), 0).toLocaleString()} actual</p>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Plus className="w-3 h-3" /> Add Milestone</Button>
                        </div>
                        <div className="space-y-1.5">
                          {project.milestones.map((ms) => (
                            <div key={ms.id} className="rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden">
                              <div className="flex items-center gap-3 px-3 py-2.5">
                                {milestoneStatusIcon[ms.status]}
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setMilestoneDetail({ projectId: project.id, milestone: ms }); setMilestoneActual(String(ms.actual_amount || ms.amount)); setMilestoneDetailOpen(true); }}>
                                  <p className="text-sm font-medium truncate">{ms.title}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>Due {ms.dueDate}</span>
                                    {ms.deliverables && <span>• {ms.deliverables.split(',').length} deliverable(s)</span>}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm font-semibold text-foreground">${ms.amount.toLocaleString()}</span>
                                  {ms.actual_amount != null && (
                                    <p className="text-[10px] text-muted-foreground">Actual: ${ms.actual_amount.toLocaleString()}</p>
                                  )}
                                </div>
                                {ms.approved ? (
                                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 bg-emerald-500/10">Approved</Badge>
                                ) : ms.status === 'completed' || ms.status === 'in_progress' ? (
                                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1"
                                    onClick={(e) => { e.stopPropagation(); handleApproveMilestone(project.id, ms.id); }}>
                                    <CheckCircle2 className="w-3 h-3" /> Approve
                                  </Button>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] capitalize">{ms.status}</Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      {/* Consultants Tab — consolidated view of tasks per consultant */}
                      <TabsContent value="consultants" className="space-y-3 mt-0">
                        {(() => {
                          const consultantMap: Record<string, ProjectTask[]> = {};
                          project.tasks.forEach(t => {
                            t.assignees.forEach(a => {
                              if (!consultantMap[a]) consultantMap[a] = [];
                              consultantMap[a].push(t);
                            });
                          });
                          const consultants = Object.entries(consultantMap);
                          if (consultants.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">No consultants assigned yet</p>;
                          return consultants.map(([name, tasks]) => {
                            const totalPlanned = tasks.reduce((s, t) => s + (t.planned_hours || 0), 0);
                            const totalActual = tasks.reduce((s, t) => s + (t.actual_hours || 0), 0);
                            const doneTasks = tasks.filter(t => t.status === 'done').length;
                            return (
                              <Card key={name} className="rounded-xl border-border/50">
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <UserCheck className="w-4 h-4 text-primary" />
                                      <span className="font-medium text-sm">{name}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                      <span>{doneTasks}/{tasks.length} done</span>
                                      <span>{totalActual}h / {totalPlanned}h</span>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {tasks.map(task => (
                                      <div key={task.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/20 text-xs">
                                        {taskStatusIcon[task.status]}
                                        <span className="flex-1 truncate">{task.title}</span>
                                        <span className="text-muted-foreground">{task.actual_hours || 0}h / {task.planned_hours || 0}h</span>
                                        <Badge variant="outline" className={`text-[9px] ${priorityBadge[task.priority]}`}>{task.priority}</Badge>
                                      </div>
                                    ))}
                                  </div>
                                  {/* Latest consultant updates */}
                                  {tasks.some(t => t.consultant_updates?.length) && (
                                    <>
                                      <Separator />
                                      <div className="space-y-1">
                                        <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Latest Updates</p>
                                        {tasks.flatMap(t => (t.consultant_updates || []).map(u => ({ ...u, taskTitle: t.title }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map((u, i) => (
                                          <div key={i} className="text-[11px] text-muted-foreground pl-4 border-l-2 border-primary/30 py-0.5">
                                            <p className="text-foreground">{u.taskTitle}: {u.notes}</p>
                                            <p>{u.hours}h • {u.date}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </CardContent>
                              </Card>
                            );
                          });
                        })()}
                      </TabsContent>

                      {/* Activity Tab */}
                      <TabsContent value="activity" className="space-y-0 mt-0">
                        {project.activities.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
                        ) : (
                          <div className="relative pl-4 border-l-2 border-border/50 space-y-4 ml-2">
                            {project.activities.map(act => (
                              <div key={act.id} className="relative">
                                <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-background ${act.type === 'update' ? 'bg-amber-500' : act.type === 'milestone' ? 'bg-emerald-500' : 'bg-primary'}`} />
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

      {/* Add Task Dialog */}
      <Dialog open={addTaskOpen} onOpenChange={setAddTaskOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
            <DialogDescription>Create a new task and assign consultants</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input placeholder="Enter task title..." value={newTask.title} onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Task description (optional)" value={newTask.description} onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={newTask.priority} onValueChange={(v) => setNewTask(prev => ({ ...prev, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Planned Hours</Label>
                <Input type="number" placeholder="e.g. 16" value={newTask.planned_hours} onChange={(e) => setNewTask(prev => ({ ...prev, planned_hours: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input type="date" value={newTask.due_date} onChange={(e) => setNewTask(prev => ({ ...prev, due_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Assign Consultants</Label>
              {selectedAssignees.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedAssignees.map(a => (
                    <Badge key={a} variant="secondary" className="text-xs gap-1 pr-1">
                      {a}
                      <button onClick={() => toggleAssignee(a)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="border rounded-lg divide-y divide-border/50 max-h-40 overflow-y-auto">
                {availableConsultants.map(name => (
                  <label key={name} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm">
                    <Checkbox checked={selectedAssignees.includes(name)} onCheckedChange={() => toggleAssignee(name)} />
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    {name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTaskOpen(false)}>Cancel</Button>
            <Button onClick={handleAddTask}>Add Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Ticket Dialog */}
      <Dialog open={assignTicketOpen} onOpenChange={setAssignTicketOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign Tickets to Project</DialogTitle>
            <DialogDescription>Select tickets to link to this project</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search tickets..." className="pl-9" value={ticketSearch} onChange={(e) => setTicketSearch(e.target.value)} />
            </div>
            {selectedTicketIds.length > 0 && <p className="text-xs text-muted-foreground">{selectedTicketIds.length} ticket(s) selected</p>}
            <ScrollArea className="h-[300px] border rounded-lg">
              {ticketsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Clock className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading tickets...</span>
                </div>
              ) : filteredClientTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  {clientTickets.length === 0 ? 'No tickets found.' : 'No tickets match your search.'}
                </p>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredClientTickets.map(ticket => {
                    const isAlreadyAssigned = currentProjectTicketIds.has(ticket.id);
                    const isSelected = selectedTicketIds.includes(ticket.id);
                    return (
                      <label key={ticket.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isAlreadyAssigned ? 'opacity-50 cursor-not-allowed bg-muted/30' : 'hover:bg-muted/50'}`}>
                        <Checkbox checked={isSelected || isAlreadyAssigned} disabled={isAlreadyAssigned} onCheckedChange={() => !isAlreadyAssigned && toggleTicketSelection(ticket.id)} />
                        <span className={`w-2 h-2 rounded-full shrink-0 ${urgencyDot[ticket.urgency] || 'bg-muted-foreground'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{ticket.title}</p>
                          <p className="text-[10px] text-muted-foreground">{ticket.sap_module} • {ticket.status.replace('_', ' ')}</p>
                        </div>
                        {isAlreadyAssigned && <Badge variant="outline" className="text-[9px] text-muted-foreground">Assigned</Badge>}
                      </label>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTicketOpen(false)}>Cancel</Button>
            <Button onClick={handleAssignTickets} disabled={selectedTicketIds.length === 0}>
              Assign {selectedTicketIds.length > 0 ? `(${selectedTicketIds.length})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enter Actuals Dialog */}
      <Dialog open={actualsOpen} onOpenChange={setActualsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-primary" /> Enter Actuals</DialogTitle>
            <DialogDescription>
              {actualsTask && projects.find(p => p.id === actualsTask.projectId)?.tasks.find(t => t.id === actualsTask.taskId)?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hours Worked *</Label>
              <Input type="number" placeholder="e.g. 8" value={actualsForm.hours} onChange={(e) => setActualsForm(prev => ({ ...prev, hours: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Update Status</Label>
              <Select value={actualsForm.status} onValueChange={(v) => setActualsForm(prev => ({ ...prev, status: v }))}>
                <SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="in_review">In Review</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="What was done..." value={actualsForm.notes} onChange={(e) => setActualsForm(prev => ({ ...prev, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActualsOpen(false)}>Cancel</Button>
            <Button onClick={handleEnterActuals}>Save Actuals</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Detail Dialog */}
      <Dialog open={taskDetailOpen} onOpenChange={setTaskDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Task Details</DialogTitle>
          </DialogHeader>
          {taskDetail && (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold">{taskDetail.task.title}</h4>
                {taskDetail.task.description && <p className="text-sm text-muted-foreground mt-1">{taskDetail.task.description}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className="ml-1 text-[10px]">{taskDetail.task.status}</Badge></div>
                <div><span className="text-muted-foreground">Priority:</span> <Badge variant="outline" className={`ml-1 text-[10px] ${priorityBadge[taskDetail.task.priority]}`}>{taskDetail.task.priority}</Badge></div>
                <div><span className="text-muted-foreground">Planned:</span> <span className="font-medium ml-1">{taskDetail.task.planned_hours || 0}h</span></div>
                <div><span className="text-muted-foreground">Actual:</span> <span className="font-medium ml-1">{taskDetail.task.actual_hours || 0}h</span></div>
                {taskDetail.task.due_date && <div><span className="text-muted-foreground">Due:</span> <span className="ml-1">{taskDetail.task.due_date}</span></div>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-1">Assignees</p>
                <div className="flex flex-wrap gap-1.5">
                  {taskDetail.task.assignees.length === 0 ? <span className="text-sm text-muted-foreground">Unassigned</span> : taskDetail.task.assignees.map(a => <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>)}
                </div>
              </div>
              {taskDetail.task.consultant_updates && taskDetail.task.consultant_updates.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-2 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Consultant Updates</p>
                  <div className="space-y-2">
                    {taskDetail.task.consultant_updates.map((u, i) => (
                      <div key={i} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{u.consultant}</span>
                          <span className="text-xs text-muted-foreground">{u.date}</span>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1">{u.notes} • {u.hours}h</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Milestone Detail Dialog */}
      <Dialog open={milestoneDetailOpen} onOpenChange={setMilestoneDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MilestoneIcon className="w-5 h-5 text-primary" /> Milestone Details</DialogTitle>
          </DialogHeader>
          {milestoneDetail && (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold">{milestoneDetail.milestone.title}</h4>
                <p className="text-xs text-muted-foreground mt-1">Due: {milestoneDetail.milestone.dueDate}</p>
              </div>
              {milestoneDetail.milestone.deliverables && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1">Deliverables</p>
                  <div className="space-y-1">
                    {milestoneDetail.milestone.deliverables.split(',').map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                        {d.trim()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Planned:</span> <span className="font-semibold ml-1">${milestoneDetail.milestone.amount.toLocaleString()}</span></div>
                <div>
                  <Label className="text-muted-foreground">Actual Amount</Label>
                  <Input type="number" value={milestoneActual} onChange={(e) => setMilestoneActual(e.target.value)} className="mt-1" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMilestoneDetailOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveMilestoneActual}>Save Actual</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> {confirmAction?.title}</DialogTitle>
            <DialogDescription>{confirmAction?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => { confirmAction?.onConfirm(); setConfirmOpen(false); }}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

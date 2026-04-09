import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ClipboardList, Plus, Search, Filter, Clock, Users, CalendarDays,
  AlertTriangle, CheckCircle2, Timer, ArrowUpRight, BarChart3,
  GitBranch, Target, Layers, FileText, MessageSquare, Paperclip
} from 'lucide-react';
import { useState } from 'react';

const tickets = [
  {
    id: 'PMT-001',
    title: 'SAP S/4HANA Data Migration - Phase 2 Cutover Planning',
    description: 'Plan and execute the second phase of data migration including FI/CO master data, open items, and historical transactions.',
    status: 'in_progress',
    priority: 'critical',
    type: 'migration',
    assignee: 'Ahmed Al-Rashid',
    project: 'SAP S/4HANA Migration',
    module: 'SAP FI/CO',
    dueDate: '2025-04-15',
    createdAt: '2025-03-20',
    progress: 45,
    comments: 12,
    attachments: 5,
    dependencies: 2,
    estimatedHours: 120,
    loggedHours: 54,
  },
  {
    id: 'PMT-002',
    title: 'Material Master Data Validation & Cleansing',
    description: 'Validate and cleanse material master data across all plants before migration to S/4HANA.',
    status: 'open',
    priority: 'high',
    type: 'data_quality',
    assignee: 'Sara Mohammed',
    project: 'SAP S/4HANA Migration',
    module: 'SAP MM',
    dueDate: '2025-04-22',
    createdAt: '2025-03-25',
    progress: 10,
    comments: 4,
    attachments: 3,
    dependencies: 1,
    estimatedHours: 80,
    loggedHours: 8,
  },
  {
    id: 'PMT-003',
    title: 'Integration Testing - SD Order-to-Cash Flow',
    description: 'End-to-end integration testing for the complete Order-to-Cash business process in the new S/4HANA system.',
    status: 'in_progress',
    priority: 'high',
    type: 'testing',
    assignee: 'Omar Khaled',
    project: 'SAP S/4HANA Migration',
    module: 'SAP SD',
    dueDate: '2025-05-01',
    createdAt: '2025-03-15',
    progress: 60,
    comments: 18,
    attachments: 8,
    dependencies: 3,
    estimatedHours: 160,
    loggedHours: 96,
  },
  {
    id: 'PMT-004',
    title: 'BW Extractor Configuration for S/4HANA',
    description: 'Configure and test BW extractors for the new S/4HANA data sources including CDS-based extraction.',
    status: 'blocked',
    priority: 'medium',
    type: 'configuration',
    assignee: 'Sara Mohammed',
    project: 'SAP BW/4HANA Reporting',
    module: 'SAP BW',
    dueDate: '2025-05-10',
    createdAt: '2025-04-01',
    progress: 20,
    comments: 7,
    attachments: 2,
    dependencies: 4,
    estimatedHours: 60,
    loggedHours: 12,
  },
  {
    id: 'PMT-005',
    title: 'User Acceptance Testing - Finance Module',
    description: 'Coordinate and execute UAT sessions with finance team for new S/4HANA financial processes.',
    status: 'open',
    priority: 'high',
    type: 'testing',
    assignee: 'Ahmed Al-Rashid',
    project: 'SAP S/4HANA Migration',
    module: 'SAP FI/CO',
    dueDate: '2025-05-15',
    createdAt: '2025-04-02',
    progress: 0,
    comments: 2,
    attachments: 1,
    dependencies: 2,
    estimatedHours: 200,
    loggedHours: 0,
  },
  {
    id: 'PMT-006',
    title: 'Fiori Launchpad Role-Based Configuration',
    description: 'Configure Fiori Launchpad groups, catalogs, and roles for all business user personas.',
    status: 'completed',
    priority: 'medium',
    type: 'configuration',
    assignee: 'Omar Khaled',
    project: 'SAP Fiori UX Redesign',
    module: 'SAP Fiori',
    dueDate: '2025-03-30',
    createdAt: '2025-03-01',
    progress: 100,
    comments: 15,
    attachments: 6,
    dependencies: 0,
    estimatedHours: 40,
    loggedHours: 38,
  },
  {
    id: 'PMT-007',
    title: 'Change Management & Training Plan Development',
    description: 'Develop comprehensive change management strategy and training plans for all affected user groups.',
    status: 'in_progress',
    priority: 'medium',
    type: 'planning',
    assignee: 'Fatima Hassan',
    project: 'SAP S/4HANA Migration',
    module: 'Cross-Module',
    dueDate: '2025-04-30',
    createdAt: '2025-03-10',
    progress: 55,
    comments: 9,
    attachments: 4,
    dependencies: 1,
    estimatedHours: 90,
    loggedHours: 50,
  },
  {
    id: 'PMT-008',
    title: 'Performance Optimization - HANA DB Tuning',
    description: 'Analyze and optimize HANA database performance including table partitioning, indexing, and query optimization.',
    status: 'open',
    priority: 'critical',
    type: 'optimization',
    assignee: 'Unassigned',
    project: 'SAP S/4HANA Migration',
    module: 'SAP BASIS',
    dueDate: '2025-05-20',
    createdAt: '2025-04-05',
    progress: 0,
    comments: 3,
    attachments: 1,
    dependencies: 0,
    estimatedHours: 100,
    loggedHours: 0,
  },
];

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  open: { label: 'Open', color: 'bg-blue-500/10 text-blue-600 border-blue-200', icon: Clock },
  in_progress: { label: 'In Progress', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', icon: Timer },
  blocked: { label: 'Blocked', color: 'bg-red-500/10 text-red-600 border-red-200', icon: AlertTriangle },
  completed: { label: 'Completed', color: 'bg-muted text-muted-foreground border-border', icon: CheckCircle2 },
};

const priorityConfig: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-500/10 text-red-600 border-red-200' },
  high: { label: 'High', color: 'bg-orange-500/10 text-orange-600 border-orange-200' },
  medium: { label: 'Medium', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-200' },
  low: { label: 'Low', color: 'bg-muted text-muted-foreground border-border' },
};

const typeConfig: Record<string, { label: string; color: string }> = {
  migration: { label: 'Migration', color: 'bg-purple-500/10 text-purple-600' },
  data_quality: { label: 'Data Quality', color: 'bg-cyan-500/10 text-cyan-600' },
  testing: { label: 'Testing', color: 'bg-indigo-500/10 text-indigo-600' },
  configuration: { label: 'Configuration', color: 'bg-teal-500/10 text-teal-600' },
  planning: { label: 'Planning', color: 'bg-blue-500/10 text-blue-600' },
  optimization: { label: 'Optimization', color: 'bg-amber-500/10 text-amber-600' },
};

const stats = [
  { label: 'Total Tickets', value: '8', icon: ClipboardList, color: 'text-primary' },
  { label: 'In Progress', value: '3', icon: Timer, color: 'text-emerald-500' },
  { label: 'Blocked', value: '1', icon: AlertTriangle, color: 'text-red-500' },
  { label: 'Hours Logged', value: '258', icon: Clock, color: 'text-blue-500' },
  { label: 'Completion Rate', value: '12.5%', icon: Target, color: 'text-amber-500' },
  { label: 'Dependencies', value: '13', icon: GitBranch, color: 'text-purple-500' },
];

export default function ProjectManagementTicketsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const filtered = tickets.filter((tk) => {
    if (search && !tk.title.toLowerCase().includes(search.toLowerCase()) && !tk.id.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && tk.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && tk.priority !== priorityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            Project Management Tickets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track and manage project-related tasks, issues, and deliverables</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5">
          <Plus className="w-4 h-4" /> Create Ticket
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="rounded-2xl border-border/50">
              <CardContent className="pt-4 pb-3 text-center">
                <Icon className={`w-5 h-5 mx-auto mb-1.5 ${s.color}`} />
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tickets by ID or title..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tickets List */}
      <div className="grid gap-3">
        {filtered.map((ticket) => {
          const sc = statusConfig[ticket.status];
          const pc = priorityConfig[ticket.priority];
          const tc = typeConfig[ticket.type];
          const StatusIcon = sc.icon;
          const hoursPercent = ticket.estimatedHours > 0 ? Math.round((ticket.loggedHours / ticket.estimatedHours) * 100) : 0;

          return (
            <Card key={ticket.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all cursor-pointer group">
              <CardContent className="p-5">
                <div className="space-y-3">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
                        <Badge variant="outline" className={`text-[9px] ${pc.color}`}>{pc.label}</Badge>
                        <Badge variant="secondary" className={`text-[9px] ${tc.color}`}>{tc.label}</Badge>
                      </div>
                      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{ticket.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={`text-[10px] ${sc.color}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {sc.label}
                      </Badge>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>

                  {/* Module & Project */}
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{ticket.module}</Badge>
                    <Badge variant="outline" className="text-[10px]">{ticket.project}</Badge>
                  </div>

                  {/* Progress bars */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Task Progress</span>
                        <span className="font-medium">{ticket.progress}%</span>
                      </div>
                      <Progress value={ticket.progress} className="h-1.5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Hours ({ticket.loggedHours}/{ticket.estimatedHours}h)</span>
                        <span className="font-medium">{hoursPercent}%</span>
                      </div>
                      <Progress value={hoursPercent} className="h-1.5" />
                    </div>
                  </div>

                  {/* Footer meta */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/30">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {ticket.assignee}</span>
                    <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> Due {ticket.dueDate}</span>
                    <span className="flex items-center gap-1"><GitBranch className="w-3.5 h-3.5" /> {ticket.dependencies} deps</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {ticket.comments}</span>
                    <span className="flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" /> {ticket.attachments}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-12 text-center">
              <ClipboardList className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">No tickets found matching your filters.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

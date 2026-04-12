import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectManagementTickets, PMTicket } from '@/hooks/useProjectManagementTickets';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  ClipboardList, Plus, Search, Clock, Users, CalendarDays,
  AlertTriangle, CheckCircle2, Timer, ArrowUpRight, Target,
  Trash2, Edit, Loader2, Layers
} from 'lucide-react';
import { format } from 'date-fns';

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  new: { label: 'New', color: 'bg-blue-500/10 text-blue-600', icon: Clock },
  under_review: { label: 'Under Review', color: 'bg-amber-500/10 text-amber-600', icon: Timer },
  matched: { label: 'Matched', color: 'bg-purple-500/10 text-purple-600', icon: Users },
  in_progress: { label: 'In Progress', color: 'bg-emerald-500/10 text-emerald-600', icon: Timer },
  waiting_for_client: { label: 'Waiting', color: 'bg-yellow-500/10 text-yellow-600', icon: Clock },
  resolved: { label: 'Resolved', color: 'bg-emerald-500/10 text-emerald-600', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
};

const urgencyConfig: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-500/10 text-red-600' },
  high: { label: 'High', color: 'bg-orange-500/10 text-orange-600' },
  medium: { label: 'Medium', color: 'bg-yellow-500/10 text-yellow-600' },
  low: { label: 'Low', color: 'bg-muted text-muted-foreground' },
};

const SAP_MODULES = [
  'SAP FI/CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP QM', 'SAP PM', 'SAP HR/HCM',
  'SAP BW', 'SAP ABAP', 'SAP BASIS', 'SAP Fiori', 'SAP S/4HANA', 'SAP BTP',
  'SAP CPI', 'SAP SuccessFactors', 'SAP Ariba', 'Cross-Module', 'Other',
];

function CreateEditTicketDialog({
  ticket,
  onSubmit,
  isLoading,
  trigger,
}: {
  ticket?: PMTicket;
  onSubmit: (data: any) => void;
  isLoading: boolean;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(ticket?.title || '');
  const [description, setDescription] = useState(ticket?.description || '');
  const [sapModule, setSapModule] = useState(ticket?.sap_module || 'SAP FI/CO');
  const [urgency, setUrgency] = useState(ticket?.urgency || 'medium');
  const [plannedHours, setPlannedHours] = useState(ticket?.planned_hours?.toString() || '');
  const [plannedCost, setPlannedCost] = useState(ticket?.planned_cost?.toString() || '');
  const [currency, setCurrency] = useState(ticket?.cost_currency || 'USD');
  const [slaDeadline, setSlaDeadline] = useState(ticket?.sla_deadline?.split('T')[0] || '');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit({
      ...(ticket ? { id: ticket.id } : {}),
      title: title.trim(),
      description: description.trim() || undefined,
      sap_module: sapModule,
      urgency,
      planned_hours: plannedHours ? Number(plannedHours) : undefined,
      planned_cost: plannedCost ? Number(plannedCost) : undefined,
      cost_currency: currency,
      sla_deadline: slaDeadline ? new Date(slaDeadline).toISOString() : undefined,
    });
    if (!ticket) {
      setTitle(''); setDescription(''); setPlannedHours(''); setPlannedCost(''); setSlaDeadline('');
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket ? 'Edit Ticket' : 'Create Project Ticket'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input placeholder="Ticket title..." value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea placeholder="Describe the task..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SAP Module</Label>
              <Select value={sapModule} onValueChange={setSapModule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SAP_MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Urgency</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Planned Hours</Label>
              <Input type="number" placeholder="0" value={plannedHours} onChange={e => setPlannedHours(e.target.value)} />
            </div>
            <div>
              <Label>Planned Cost</Label>
              <Input type="number" placeholder="0" value={plannedCost} onChange={e => setPlannedCost(e.target.value)} />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="SAR">SAR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>SLA Deadline</Label>
            <Input type="date" value={slaDeadline} onChange={e => setSlaDeadline(e.target.value)} />
          </div>
          <Button onClick={handleSubmit} className="w-full" disabled={!title.trim() || isLoading}>
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {ticket ? 'Save Changes' : 'Create Ticket'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectManagementTicketsPage() {
  const navigate = useNavigate();
  const { tickets, isLoading, createTicket, updateTicket, deleteTicket, stats } = useProjectManagementTickets();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');

  const filtered = tickets.filter((tk) => {
    if (search && !tk.title.toLowerCase().includes(search.toLowerCase()) && !tk.id.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && tk.status !== statusFilter) return false;
    if (urgencyFilter !== 'all' && tk.urgency !== urgencyFilter) return false;
    return true;
  });

  const statCards = [
    { label: 'Total', value: stats.total, icon: ClipboardList, color: 'text-primary' },
    { label: 'In Progress', value: stats.inProgress, icon: Timer, color: 'text-emerald-500' },
    { label: 'Critical', value: stats.critical, icon: AlertTriangle, color: 'text-red-500' },
    { label: 'Resolved', value: stats.resolved, icon: CheckCircle2, color: 'text-blue-500' },
    { label: 'New', value: stats.newTickets, icon: Layers, color: 'text-amber-500' },
    { label: 'Planned Hours', value: stats.totalPlannedHours, icon: Clock, color: 'text-purple-500' },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-2xl" />)}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-36 bg-muted animate-pulse rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            Project Management Tickets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track and manage project tasks, issues, and deliverables</p>
        </div>
        <CreateEditTicketDialog
          onSubmit={(data) => createTicket.mutate(data)}
          isLoading={createTicket.isPending}
          trigger={
            <Button className="gap-1.5">
              <Plus className="w-4 h-4" /> Create Ticket
            </Button>
          }
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((s) => {
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
          <Input placeholder="Search by title or ID..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Urgency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Urgency</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tickets List */}
      <div className="grid gap-3">
        {filtered.length === 0 ? (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="py-16 text-center">
              <ClipboardList className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground font-medium">No project tickets found</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Create your first project management ticket to get started</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((ticket) => {
            const sc = statusConfig[ticket.status] || statusConfig.new;
            const uc = urgencyConfig[ticket.urgency] || urgencyConfig.medium;
            const StatusIcon = sc.icon;

            return (
              <Card
                key={ticket.id}
                className="rounded-2xl border-border/50 hover:shadow-lg hover:border-accent/30 transition-all cursor-pointer group"
                onClick={() => navigate(`/client/tickets/${ticket.id}`)}
              >
                <CardContent className="p-5">
                  <div className="space-y-3">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">{ticket.id.slice(0, 8)}</span>
                          <Badge variant="outline" className={`text-[9px] ${uc.color}`}>{uc.label}</Badge>
                          <Badge variant="secondary" className="text-[9px]">{ticket.sap_module}</Badge>
                        </div>
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{ticket.title}</h3>
                        {ticket.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${sc.color}`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {sc.label}
                        </Badge>
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>

                    {/* Progress if planned hours exist */}
                    {ticket.planned_hours && ticket.planned_hours > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Planned: {ticket.planned_hours}h</span>
                          {ticket.planned_cost && (
                            <span className="font-medium">{ticket.planned_cost} {ticket.cost_currency || 'USD'}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Footer meta */}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/30">
                      {ticket.consultant_name && (
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {ticket.consultant_name}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5" />
                        Created {format(new Date(ticket.created_at), 'MMM d, yyyy')}
                      </span>
                      {ticket.sla_deadline && (
                        <span className="flex items-center gap-1">
                          <Target className="w-3.5 h-3.5" />
                          Due {format(new Date(ticket.sla_deadline), 'MMM d, yyyy')}
                        </span>
                      )}
                      {/* Action buttons */}
                      <div className="ml-auto flex gap-1" onClick={e => e.stopPropagation()}>
                        <CreateEditTicketDialog
                          ticket={ticket}
                          onSubmit={(data) => updateTicket.mutate(data)}
                          isLoading={updateTicket.isPending}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteTicket.mutate(ticket.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

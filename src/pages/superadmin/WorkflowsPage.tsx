import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Workflow, Plus, Save, Trash2, GripVertical, ChevronRight,
  Settings2, GitBranch, Timer, Mail, Bell, CheckCircle,
  ArrowRight, Zap,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const workflows = [
  {
    id: 'ticket_flow',
    name: 'Ticket Processing',
    description: 'Automated ticket triage, categorization, and assignment',
    active: true,
    steps: [
      { id: 1, name: 'Ticket Created', type: 'trigger' },
      { id: 2, name: 'AI Categorize', type: 'action' },
      { id: 3, name: 'Is Critical?', type: 'condition' },
      { id: 4, name: 'Match Consultant', type: 'action' },
      { id: 5, name: 'Send Notification', type: 'notification' },
    ],
  },
  {
    id: 'onboarding_flow',
    name: 'Client Onboarding',
    description: 'New client welcome sequence and profile setup',
    active: true,
    steps: [
      { id: 1, name: 'User Signed Up', type: 'trigger' },
      { id: 2, name: 'Send Welcome Email', type: 'notification' },
      { id: 3, name: 'Wait 24h', type: 'delay' },
      { id: 4, name: 'Check Profile Complete', type: 'condition' },
      { id: 5, name: 'Send Reminder', type: 'notification' },
    ],
  },
  {
    id: 'escalation_flow',
    name: 'Ticket Escalation',
    description: 'Auto-escalate unresolved critical tickets',
    active: false,
    steps: [
      { id: 1, name: 'Ticket Unresolved 15m', type: 'trigger' },
      { id: 2, name: 'Escalate to Admin', type: 'action' },
      { id: 3, name: 'Notify Admin', type: 'notification' },
    ],
  },
  {
    id: 'payment_flow',
    name: 'Payment Processing',
    description: 'Payment confirmation and receipt generation',
    active: true,
    steps: [
      { id: 1, name: 'Payment Received', type: 'trigger' },
      { id: 2, name: 'Generate Invoice', type: 'action' },
      { id: 3, name: 'Send Receipt', type: 'notification' },
      { id: 4, name: 'Update Earnings', type: 'action' },
    ],
  },
];

const stepTypeConfig: Record<string, { color: string; icon: typeof Zap }> = {
  trigger: { color: 'bg-accent/10 text-accent border-accent/30', icon: Zap },
  action: { color: 'bg-primary/10 text-primary border-primary/30', icon: Settings2 },
  condition: { color: 'bg-amber-500/10 text-amber-600 border-amber-500/30', icon: GitBranch },
  notification: { color: 'bg-green-500/10 text-green-600 border-green-500/30', icon: Bell },
  delay: { color: 'bg-purple-500/10 text-purple-600 border-purple-500/30', icon: Timer },
};

export default function WorkflowsPage() {
  const { t } = useTranslation();
  const [activeWorkflows, setActiveWorkflows] = useState(workflows);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(workflows[0].id);

  const handleToggle = (id: string) => {
    setActiveWorkflows(prev => prev.map(w =>
      w.id === id ? { ...w, active: !w.active } : w
    ));
    toast.success(t('super_admin.workflow_toggled', 'Workflow status updated'));
  };

  const selected = activeWorkflows.find(w => w.id === selectedWorkflow);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.workflows_title', 'Workflow Builder')}</h1>
          <p className="text-sm text-muted-foreground">{t('super_admin.workflows_subtitle', 'Design and manage automated workflows visually')}</p>
        </div>
        <Button className="gradient-primary border-0">
          <Plus className="w-4 h-4 me-1" /> {t('super_admin.new_workflow', 'New Workflow')}
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Workflow List */}
        <div className="space-y-3">
          {activeWorkflows.map(wf => (
            <Card
              key={wf.id}
              className={`border-border/50 cursor-pointer transition-all hover:shadow-md ${selectedWorkflow === wf.id ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => setSelectedWorkflow(wf.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">{wf.name}</h3>
                  <Switch checked={wf.active} onCheckedChange={() => handleToggle(wf.id)} />
                </div>
                <p className="text-xs text-muted-foreground mb-2">{wf.description}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[9px] ${wf.active ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground'}`}>
                    {wf.active ? 'Active' : 'Inactive'}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{wf.steps.length} steps</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Workflow Detail */}
        <div className="md:col-span-2">
          {selected ? (
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{selected.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <Plus className="w-3 h-3 me-1" /> Add Step
                    </Button>
                    <Button className="gradient-primary border-0" size="sm" onClick={() => toast.success('Workflow saved')}>
                      <Save className="w-3 h-3 me-1" /> Save
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selected.steps.map((step, i) => {
                    const config = stepTypeConfig[step.type] || stepTypeConfig.action;
                    const StepIcon = config.icon;
                    return (
                      <div key={step.id}>
                        <div className={`flex items-center gap-3 p-3 rounded-lg border ${config.color}`}>
                          <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
                          <div className="w-8 h-8 rounded-lg bg-background/50 flex items-center justify-center shrink-0">
                            <StepIcon className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[8px] uppercase tracking-wider">{step.type}</Badge>
                              <span className="text-sm font-medium">{step.name}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <Settings2 className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        {i < selected.steps.length - 1 && (
                          <div className="flex justify-center py-1">
                            <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/50">
              <CardContent className="p-8 text-center text-muted-foreground">
                Select a workflow to view and edit
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

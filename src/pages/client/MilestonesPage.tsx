import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useProjectMilestones, useUpdateMilestoneStatus } from '@/hooks/useMilestones';
import { CheckCircle2, Circle, DollarSign, Lock, ArrowRight, Milestone as MilestoneIcon, Wallet } from 'lucide-react';
import { toast } from 'sonner';

const escrowConfig: Record<string, { label: string; color: string; bg: string }> = {
  unfunded: { label: 'Unfunded', color: 'text-muted-foreground', bg: 'bg-muted' },
  funded: { label: 'Funded (Escrow)', color: 'text-blue-600', bg: 'bg-blue-100' },
  in_progress: { label: 'In Progress', color: 'text-amber-600', bg: 'bg-amber-100' },
  submitted: { label: 'Submitted for Review', color: 'text-purple-600', bg: 'bg-purple-100' },
  approved: { label: 'Approved', color: 'text-green-600', bg: 'bg-green-100' },
  released: { label: 'Released', color: 'text-green-700', bg: 'bg-green-100' },
  disputed: { label: 'Disputed', color: 'text-red-600', bg: 'bg-red-100' },
};

const demoProjectId = 'demo-project-1';

export default function MilestonesPage() {
  const { data: milestones, isLoading } = useProjectMilestones(demoProjectId);
  const updateStatus = useUpdateMilestoneStatus();

  const totalAmount = (milestones || []).reduce((s: number, m: any) => s + (m.amount || 0), 0);
  const releasedAmount = (milestones || []).reduce((s: number, m: any) => m.escrow_status === 'released' ? s + (m.amount || 0) : s, 0);
  const fundedAmount = (milestones || []).reduce((s: number, m: any) => ['funded', 'in_progress', 'submitted', 'approved'].includes(m.escrow_status) ? s + (m.amount || 0) : s, 0);
  const progress = totalAmount > 0 ? ((releasedAmount / totalAmount) * 100) : 0;

  const handleAction = (id: string, newStatus: string) => {
    updateStatus.mutate(
      { id, escrow_status: newStatus, project_id: demoProjectId },
      {
        onSuccess: () => toast.success(`Milestone ${newStatus}`),
        onError: () => toast.error('Failed to update milestone'),
      }
    );
  };

  const getNextAction = (status: string): { label: string; next: string; variant: 'default' | 'outline' } | null => {
    switch (status) {
      case 'unfunded': return { label: 'Fund Escrow', next: 'funded', variant: 'default' };
      case 'funded': return null; // consultant starts work
      case 'submitted': return { label: 'Approve', next: 'approved', variant: 'default' };
      case 'approved': return { label: 'Release Payment', next: 'released', variant: 'default' };
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Milestones & Escrow</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage project milestones with secure escrow payments</p>
      </div>

      {/* Summary */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-foreground">Project Progress</p>
              <p className="text-xs text-muted-foreground">{(milestones || []).filter((m: any) => m.escrow_status === 'released').length} of {(milestones || []).length} milestones completed</p>
            </div>
            <div className="text-end">
              <p className="text-lg font-bold text-foreground">${releasedAmount.toLocaleString()} <span className="text-xs text-muted-foreground font-normal">/ ${totalAmount.toLocaleString()}</span></p>
              <p className="text-[10px] text-muted-foreground">${fundedAmount.toLocaleString()} in escrow</p>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </CardContent>
      </Card>

      {/* Milestone List */}
      <div className="space-y-3">
        {(milestones || []).map((m: any, idx: number) => {
          const config = escrowConfig[m.escrow_status] || escrowConfig.unfunded;
          const action = getNextAction(m.escrow_status);
          const isComplete = m.escrow_status === 'released';
          return (
            <Card key={m.id} className={`rounded-2xl border-border/50 transition-all ${isComplete ? 'opacity-75' : 'hover:shadow-premium'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-1 pt-1">
                    {isComplete ? (
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center text-[10px] font-bold text-primary">
                        {idx + 1}
                      </div>
                    )}
                    {idx < (milestones || []).length - 1 && (
                      <div className="w-0.5 h-8 bg-border/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className={`font-semibold ${isComplete ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{m.title}</h3>
                      <Badge variant="secondary" className={`text-[10px] shrink-0 ${config.bg} ${config.color}`}>
                        {config.label}
                      </Badge>
                    </div>
                    {m.description && <p className="text-xs text-muted-foreground mt-1">{m.description}</p>}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 font-semibold text-foreground">
                        <DollarSign className="w-3 h-3" /> ${m.amount?.toLocaleString()} {m.currency}
                      </span>
                      {m.due_date && <span>Due: {new Date(m.due_date).toLocaleDateString()}</span>}
                      {m.escrow_status !== 'unfunded' && m.escrow_status !== 'released' && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Lock className="w-3 h-3" /> In Escrow
                        </span>
                      )}
                    </div>
                    {action && (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant={action.variant}
                          className={`text-xs gap-1.5 h-8 ${action.variant === 'default' ? 'gradient-primary border-0' : ''}`}
                          onClick={() => handleAction(m.id, action.next)}
                          disabled={updateStatus.isPending}
                        >
                          <Wallet className="w-3.5 h-3.5" /> {action.label}
                          <ArrowRight className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
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

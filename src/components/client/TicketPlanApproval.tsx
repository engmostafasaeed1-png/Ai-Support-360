import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Calculator, CheckCircle2, XCircle, Clock, DollarSign,
  Timer, Loader2, FileCheck, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import type { TicketDetail } from '@/hooks/useTicketDetail';
import TicketPlanSubmitForm from '@/components/consultant/TicketPlanSubmitForm';

interface Props {
  ticket: TicketDetail;
  isClient: boolean;
}

export default function TicketPlanApproval({ ticket, isClient }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const isPendingApproval = !!ticket.plan_submitted_at && !ticket.plan_approved_at && !ticket.plan_rejected_at;
  const isApproved = !!ticket.plan_approved_at;
  const isRejected = !!ticket.plan_rejected_at && !ticket.plan_approved_at;
  const hasNoPlan = !ticket.plan_submitted_at;

  const handleApprove = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('tickets')
        .update({
          plan_approved_at: new Date().toISOString(),
          plan_approved_by: user?.id,
          plan_rejected_at: null,
          plan_rejection_reason: null,
        } as any)
        .eq('id', ticket.id);
      if (error) throw error;
      toast.success('Plan approved! Work can begin.');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticket.id] });
    } catch {
      toast.error('Failed to approve plan');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) { toast.error('Please provide a reason'); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          plan_rejected_at: new Date().toISOString(),
          plan_rejection_reason: rejectionReason.trim(),
          plan_approved_at: null,
        } as any)
        .eq('id', ticket.id);
      if (error) throw error;
      toast.success('Plan rejected. Consultant will revise.');
      setRejecting(false);
      setRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticket.id] });
    } catch {
      toast.error('Failed to reject plan');
    } finally {
      setSaving(false);
    }
  };

  const breakdown = Array.isArray(ticket.cost_breakdown) ? ticket.cost_breakdown : [];

  return (
    <Card className="rounded-2xl border-border/50 overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 flex items-center gap-2 text-sm font-semibold ${
        isApproved ? 'bg-green-500/10 text-green-700' :
        isRejected ? 'bg-red-500/10 text-red-700' :
        isPendingApproval ? 'bg-amber-500/10 text-amber-700' :
        'bg-muted/30 text-muted-foreground'
      }`}>
        {isApproved ? <CheckCircle2 className="w-4 h-4" /> :
         isRejected ? <XCircle className="w-4 h-4" /> :
         isPendingApproval ? <Clock className="w-4 h-4" /> :
         <Calculator className="w-4 h-4" />}
        {isApproved ? 'Plan Approved' :
         isRejected ? 'Plan Rejected — Needs Revision' :
         isPendingApproval ? 'Awaiting Client Approval' :
         'Cost & Effort Plan'}
        {isApproved && ticket.plan_approved_at && (
          <span className="text-[10px] font-normal ms-auto">
            {format(new Date(ticket.plan_approved_at), 'MMM d, yyyy')}
          </span>
        )}
      </div>

      <CardContent className="p-4 space-y-4">
        {/* Plan Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-muted/30 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Timer className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Planned Effort</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {ticket.planned_hours || 0}<span className="text-sm font-normal text-muted-foreground"> hrs</span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-muted/30 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Planned Cost</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {(ticket.planned_cost || 0).toLocaleString()}
              <span className="text-sm font-normal text-muted-foreground"> {ticket.cost_currency || 'USD'}</span>
            </p>
          </div>
        </div>

        {/* Cost Breakdown */}
        {breakdown.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cost Breakdown</p>
            <div className="space-y-1">
              {breakdown.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/20 text-sm">
                  <span className="text-foreground">{item.label || `Item ${i + 1}`}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {item.hours && <span>{item.hours}h</span>}
                    <span className="font-medium text-foreground">
                      {(item.cost || 0).toLocaleString()} {ticket.cost_currency || 'USD'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rejection reason */}
        {isRejected && ticket.plan_rejection_reason && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm">
            <div className="flex items-center gap-1.5 text-red-700 font-medium mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Rejection Reason
            </div>
            <p className="text-red-600">{ticket.plan_rejection_reason}</p>
          </div>
        )}

        {/* Client approval actions */}
        {isClient && isPendingApproval && !rejecting && (
          <div className="flex gap-2 pt-1">
            <Button onClick={handleApprove} disabled={saving} className="flex-1 gradient-primary border-0 gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve Plan
            </Button>
            <Button variant="outline" onClick={() => setRejecting(true)} disabled={saving} className="flex-1 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5">
              <XCircle className="w-4 h-4" /> Reject
            </Button>
          </div>
        )}

        {/* Rejection form */}
        {isClient && rejecting && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Reason for rejection</Label>
              <Textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Explain what needs to be revised..."
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleReject} disabled={saving} variant="destructive" className="flex-1 gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Confirm Rejection
              </Button>
              <Button variant="outline" onClick={() => { setRejecting(false); setRejectionReason(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* The assigned consultant submits or revises the plan here */}
        {!isClient && <TicketPlanSubmitForm ticket={ticket} />}

        {/* No plan yet */}
        {hasNoPlan && (
          <p className="text-xs text-muted-foreground italic text-center py-2">
            No plan submitted yet. The consultant will submit a cost & effort plan for approval.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

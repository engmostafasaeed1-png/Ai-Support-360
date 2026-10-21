import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { History, ShieldCheck, ShieldAlert, ShieldX, Shield, Clock, User } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface Props {
  consultantId: string;
  className?: string;
}

interface AuditEntry {
  id: string;
  old_status: string | null;
  new_status: string;
  reviewer_id: string | null;
  reason: string | null;
  created_at: string;
  reviewer_name?: string | null;
}

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  verified: { label: 'Verified', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: ShieldCheck },
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  under_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Shield },
  on_hold: { label: 'On Hold', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: ShieldAlert },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: ShieldX },
  suspended: { label: 'Suspended', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: ShieldX },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline" className="text-[10px]">—</Badge>;
  const meta = STATUS_META[status] || { label: status, color: 'bg-muted text-muted-foreground', icon: Shield };
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={`text-[10px] gap-1 ${meta.color}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </Badge>
  );
}

export default function ConsultantVerificationAuditLog({ consultantId, className }: Props) {
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery({
    queryKey: ['consultant-verification-audit', consultantId],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from('consultant_verification_audit')
        .select('id, old_status, new_status, reviewer_id, reason, created_at')
        .eq('consultant_id', consultantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as AuditEntry[];

      const reviewerIds = Array.from(new Set(rows.map(r => r.reviewer_id).filter(Boolean) as string[]));
      if (reviewerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', reviewerIds);
        const nameMap = new Map((profiles || []).map(p => [p.user_id, p.display_name]));
        return rows.map(r => ({
          ...r,
          reviewer_name: r.reviewer_id ? nameMap.get(r.reviewer_id) || null : null,
        }));
      }
      return rows;
    },
    enabled: !!consultantId,
  });


  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Verification audit log</h3>
        {entries && <Badge variant="outline" className="text-[10px]">{entries.length}</Badge>}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : !entries || entries.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No verification status changes recorded yet.
        </p>
      ) : (
        <ol className="relative ms-3 border-s border-border/50 space-y-4">
          {entries.map((e) => (
            <li key={e.id} className="ms-4">
              <span className="absolute -start-1.5 mt-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
              <div className="rounded-xl border border-border/50 p-3 space-y-1.5 bg-card">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={e.old_status} />
                  <span className="text-xs text-muted-foreground">→</span>
                  <StatusBadge status={e.new_status} />
                  <span
                    className="ms-auto text-[10px] text-muted-foreground"
                    title={format(new Date(e.created_at), 'PPpp')}
                  >
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User className="w-3 h-3" />
                  <span>
                    Reviewer:{' '}
                    <span className="text-foreground font-medium">
                      {e.reviewer_name || (e.reviewer_id ? 'Admin' : 'System')}
                    </span>
                  </span>
                </div>
                {e.reason && (
                  <p className="text-xs text-muted-foreground italic border-s-2 border-border ps-2 mt-1">
                    "{e.reason}"
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

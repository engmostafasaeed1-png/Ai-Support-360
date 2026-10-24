import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrdApproval, listBrdApprovals } from '@/lib/brd/approvalApi';
import type { ApprovalListRow, ApprovalView } from '@/lib/brdApproval';

/** Approval rounds, decisions and the gate of one ticket for the signed-in person. Null while the feature is not installed. */
export function useBrdApproval(ticketId: string | undefined) {
  return useQuery<ApprovalView | null>({
    queryKey: ['brd-approval', ticketId],
    queryFn: async () => {
      const r = await getBrdApproval(ticketId!);
      if (r.error || !r.data) return null;
      return r.data;
    },
    enabled: !!ticketId,
    staleTime: 30_000,
    retry: false,
  });
}

export function useRefreshBrdApproval(ticketId: string | undefined) {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['brd-approval', ticketId] });
    void qc.invalidateQueries({ queryKey: ['brd', ticketId] });
    void qc.invalidateQueries({ queryKey: ['brd-approval-list'] });
    void qc.invalidateQueries({ queryKey: ['ticket-tracking', ticketId] });
  }, [qc, ticketId]);
}

/** Approval state per ticket for lists ("Needs my approval", "Awaiting consultant approval"). Empty when not installed. */
export function useBrdApprovalList(ids: readonly string[]) {
  const key = useMemo(() => [...ids].sort().join(','), [ids]);
  const q = useQuery<Map<string, ApprovalListRow>>({
    queryKey: ['brd-approval-list', key],
    queryFn: async () => {
      const r = await listBrdApprovals([...ids]);
      const m = new Map<string, ApprovalListRow>();
      for (const row of r.data ?? []) m.set(row.ticket_id, row);
      return m;
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  return q.data ?? new Map<string, ApprovalListRow>();
}

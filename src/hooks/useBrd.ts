import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getBrd, type BrdState } from '@/lib/brd/api';

export class BrdLoadError extends Error {
  constructor(message: string, public notReady: boolean) { super(message); }
}

/** The BRD of a ticket as the signed-in person may see it (role, versions, attachments, comments). */
export function useBrd(ticketId: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery<BrdState, BrdLoadError>({
    queryKey: ['brd', ticketId],
    queryFn: async () => {
      const r = await getBrd(ticketId!);
      if (r.error || !r.data) throw new BrdLoadError(r.error?.message ?? 'Not available', !!r.notReady);
      return r.data;
    },
    enabled: !!ticketId && opts.enabled !== false,
    staleTime: 30_000,
    retry: false,
  });
}

export function useRefreshBrd(ticketId: string | undefined) {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['brd', ticketId] }), [qc, ticketId]);
}

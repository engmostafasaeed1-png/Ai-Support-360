import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNdaStatus, fetchSigningSettings } from '@/lib/nda/api';

/** null data = stricter signing not installed yet (screens keep the previous dialogs). */
export function useNdaSigningSettings() {
  return useQuery({ queryKey: ['nda-signing-settings'], queryFn: fetchSigningSettings, staleTime: 5 * 60_000, retry: false });
}

export function useNdaStatus(a: { ndaId?: string | null; consultantId?: string | null; clientId?: string | null }, enabled = true) {
  return useQuery({
    queryKey: ['nda-status', a.ndaId ?? null, a.ndaId ? null : a.consultantId ?? null, a.ndaId ? null : a.clientId ?? null],
    queryFn: () => fetchNdaStatus(a),
    enabled: enabled && (!!a.ndaId || (!!a.consultantId && !!a.clientId)),
    staleTime: 30_000,
  });
}

const NDA_KEYS = new Set(['nda-status', 'ticket-nda-status', 'case-nda-status', 'consultant-nda-map', 'nda-list', 'client-nda-consultant-ids', 'nda-pending-access', 'admin-nda-signatures', 'ticket-tracking']);

/** Refresh every NDA view after a signature, a reminder or a revocation. */
export function useRefreshNda() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (q) => NDA_KEYS.has(String(q.queryKey[0])) }), [qc]);
}

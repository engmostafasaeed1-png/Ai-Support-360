import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseSuccessSettings, SUCCESS_DEFAULTS, type SuccessCounts, type SuccessSettings } from '@/lib/successLevel';
import { safeRpc } from '@/lib/safeRpc';

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  safeRpc(fn, args);

export interface SuccessConfig { available: boolean; publicOn: boolean; settings: SuccessSettings }
const OFF: SuccessConfig = { available: false, publicOn: false, settings: SUCCESS_DEFAULTS };

/**
 * success_public_config() from docs/sql/success-stats.sql. Fails closed: until that file is applied (or when the
 * owner switches `success_public` off) nothing about success is shown anywhere.
 */
export function useSuccessConfig(): SuccessConfig {
  const q = useQuery({
    queryKey: ['success-public-config'],
    staleTime: 15 * 60_000,
    retry: false,
    queryFn: async (): Promise<SuccessConfig> => {
      const { data, error } = await rpc('success_public_config');
      if (error || !data || typeof data !== 'object') return OFF;
      const o = data as Record<string, unknown>;
      return { available: true, publicOn: o.public === true, settings: parseSuccessSettings(o) };
    },
  });
  return q.data ?? OFF;
}

interface Row extends SuccessCounts { consultant_id: string }
const toCounts = (r: Row): SuccessCounts => ({
  requests_total: Number(r.requests_total) || 0, solved: Number(r.solved) || 0, not_solved: Number(r.not_solved) || 0,
  requests_12m: Number(r.requests_12m) || 0, solved_12m: Number(r.solved_12m) || 0,
});

// Cards on one screen ask together: ids are collected for one tick and read in one request (counts only).
let queue = new Map<string, Array<(v: SuccessCounts | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

export async function fetchSuccessStats(ids: string[]): Promise<Map<string, SuccessCounts>> {
  const found = new Map<string, SuccessCounts>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await rpc('consultant_success_stats', { _consultant_ids: ids.slice(i, i + 500) });
    if (error) break;
    for (const r of (data ?? []) as Row[]) found.set(r.consultant_id, toCounts(r));
  }
  return found;
}

async function flush() {
  const batch = queue;
  queue = new Map();
  timer = null;
  const found = await fetchSuccessStats([...batch.keys()]).catch(() => new Map<string, SuccessCounts>());
  for (const [id, waiters] of batch) waiters.forEach((w) => w(found.get(id) ?? null));
}

export function loadSuccessStats(id: string): Promise<SuccessCounts | null> {
  return new Promise((resolve) => {
    queue.set(id, [...(queue.get(id) ?? []), resolve]);
    if (!timer) timer = setTimeout(() => { void flush(); }, 0);
  });
}

/** Counts for one consultant (null when not readable); only asked while the public display is on. */
export function useSuccessStat(consultantId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['success-stat', consultantId],
    enabled: enabled && !!consultantId,
    staleTime: 10 * 60_000,
    queryFn: () => loadSuccessStats(consultantId as string),
  });
}

/** Counts for a whole list (directory sort and filter); also fills the per-card cache so cards do not ask again. */
export function useSuccessStatsMap(ids: string[], enabled: boolean): Map<string, SuccessCounts> | null {
  const qc = useQueryClient();
  const key = useMemo(() => [...ids].sort().join(','), [ids]);
  const q = useQuery({
    queryKey: ['success-stats-map', key],
    enabled: enabled && ids.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => fetchSuccessStats(key.split(',')),
  });
  useEffect(() => {
    if (!q.data) return;
    for (const id of key.split(',')) if (id) qc.setQueryData(['success-stat', id], q.data.get(id) ?? null);
  }, [q.data, key, qc]);
  return enabled ? q.data ?? null : null;
}

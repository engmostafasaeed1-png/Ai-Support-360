import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ClientRatingSummary {
  client_id: string;
  avg_score: number;
  review_count: number;
  communication_avg: number | null;
  clarity_avg: number | null;
  cooperation_avg: number | null;
  would_work_again_pct: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** One batched call of client_rating_summaries for a list of clients (at most 100 ids). */
export function useClientRatingSummaries(clientIds: string[]) {
  const ids = [...new Set(clientIds.filter(Boolean))].sort().slice(0, 100);
  return useQuery({
    queryKey: ['client-rating-summaries', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('client_rating_summaries', { _client_ids: ids });
      if (error) throw error;
      const map = new Map<string, ClientRatingSummary>();
      for (const r of (data || []) as any[]) {
        map.set(r.client_id, {
          client_id: r.client_id,
          avg_score: Number(r.avg_score),
          review_count: Number(r.review_count),
          communication_avg: num(r.communication_avg),
          clarity_avg: num(r.clarity_avg),
          cooperation_avg: num(r.cooperation_avg),
          would_work_again_pct: num(r.would_work_again_pct),
        });
      }
      return map;
    },
  });
}

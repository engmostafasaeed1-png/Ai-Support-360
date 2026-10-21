import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RATING_MIN_REVIEWS_DEFAULT } from '@/lib/ringAvatar';

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (fn: string): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string) => Promise<RpcResult> }).rpc(fn);

/** Platform setting `rating_min_reviews` (docs/sql/rating-ring.sql); the default 3 until that file is applied. */
export function useRatingMinReviews(): number {
  const q = useQuery({
    queryKey: ['rating-public-config'],
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await rpc('rating_public_config');
      const n = Number((data as { min_reviews?: unknown } | null)?.min_reviews);
      return !error && Number.isInteger(n) && n >= 1 && n <= 50 ? n : RATING_MIN_REVIEWS_DEFAULT;
    },
  });
  return q.data ?? RATING_MIN_REVIEWS_DEFAULT;
}

export interface RingStats { rating: number; reviews: number; badge: string | null; verified: boolean }

// Cards on one screen ask together: ids are collected for one tick and read in one request.
let queue = new Map<string, Array<(v: RingStats | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  const batch = queue;
  queue = new Map();
  timer = null;
  const ids = [...batch.keys()];
  const found = new Map<string, RingStats>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('consultants')
      .select('id, rating, total_reviews, ai_interview_badge, verification_status')
      .in('id', ids.slice(i, i + 200));
    for (const r of (data ?? []) as Array<{ id: string; rating: number | string | null; total_reviews: number | null; ai_interview_badge: string | null; verification_status: string | null }>) {
      found.set(r.id, { rating: Number(r.rating) || 0, reviews: r.total_reviews ?? 0, badge: r.ai_interview_badge, verified: r.verification_status === 'verified' });
    }
  }
  for (const [id, waiters] of batch) waiters.forEach((w) => w(found.get(id) ?? null));
}

export function loadRingStats(id: string): Promise<RingStats | null> {
  return new Promise((resolve) => {
    queue.set(id, [...(queue.get(id) ?? []), resolve]);
    if (!timer) timer = setTimeout(() => { void flush().catch(() => { /* the ring then shows "New" */ }); }, 0);
  });
}

/** Rating, review count and badge of one consultant, for cards whose data does not include them. */
export function useRingStats(consultantId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ring-stats', consultantId],
    enabled: enabled && !!consultantId,
    staleTime: 10 * 60_000,
    queryFn: () => loadRingStats(consultantId as string),
  });
}

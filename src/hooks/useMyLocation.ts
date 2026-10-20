import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { hasLocation, locationGrace, resolvePlacePoint, type LocationGrace } from '@/lib/consultantLocation';

export const MY_LOCATION_KEY = ['my-location'] as const;

export interface MyLocation {
  userId: string;
  metadata: Record<string, unknown>;
  consultantId: string | null;
  country: string;
  city: string;
  createdAt: string | null;
  graceStartedAt: string | null;
  graceDays: number | null;
}

/** The signed-in consultant's location, grace state and a one-call save (country, city and the derived map point). */
export function useMyLocation() {
  const { signedIn } = useSessionReady();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: MY_LOCATION_KEY,
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async (): Promise<MyLocation | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: c, error } = await (supabase as any).from('consultants').select('id, country, city, created_at').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      // Grace settings come from the prepared database update; until it is applied there is no deadline (nobody is blocked).
      let graceStartedAt: string | null = null; let graceDays: number | null = null;
      try {
        const { data: st, error: stErr } = await (supabase as any).rpc('my_location_status');
        if (!stErr && st && typeof st === 'object') { graceStartedAt = st.grace_started_at ?? null; graceDays = typeof st.grace_days === 'number' ? st.grace_days : null; }
      } catch { /* not available yet */ }
      return { userId: user.id, metadata: (user.user_metadata || {}) as Record<string, unknown>, consultantId: c?.id ?? null, country: c?.country ?? '', city: c?.city ?? '', createdAt: c?.created_at ?? null, graceStartedAt, graceDays };
    },
  });
  const d = q.data ?? null;
  const has = hasLocation(d);
  const grace: LocationGrace = d ? locationGrace({ hasLocation: has, graceStartedAt: d.graceStartedAt, signedUpAt: d.createdAt, graceDays: d.graceDays, now: Date.now() }) : { state: 'ok' };

  const save = async (country: string, city: string) => {
    if (!d?.consultantId) throw new Error('Save your consultant profile first.');
    const point = resolvePlacePoint(country, city, d.consultantId);
    const { error } = await (supabase as any).from('consultants')
      .update({ country: country.trim(), city: city.trim(), latitude: point?.lat ?? null, longitude: point?.lng ?? null })
      .eq('id', d.consultantId);
    if (error) throw error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: MY_LOCATION_KEY }),
      qc.invalidateQueries({ queryKey: ['consultant-profile'] }),
      qc.invalidateQueries({ queryKey: ['getting-started'] }),
      qc.invalidateQueries({ queryKey: ['my-missing-profile-fields'] }),
    ]);
  };

  return { loading: q.isLoading, data: d, isConsultant: !!d?.consultantId, has, grace, save };
}

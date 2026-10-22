import { useQuery } from '@tanstack/react-query';
import { safeRpc } from '@/lib/safeRpc';

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (fn: string): Promise<RpcResult> => safeRpc(fn);

export interface NamePrivacy {
  /** True once docs/sql/consultant-name-privacy.sql is applied (the database then masks names for every viewer). */
  installed: boolean;
  /** Setting consultant_name_masking_enabled (default on). */
  enabled: boolean;
}

/** Feature X status. Fails closed: until the prepared SQL is applied the format picker stays hidden. */
export function useNamePrivacy() {
  return useQuery<NamePrivacy>({
    queryKey: ['name-privacy-config'],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await rpc('consultant_name_privacy_config');
      if (error || !data || typeof data !== 'object') return { installed: false, enabled: true };
      return { installed: true, enabled: (data as { enabled?: unknown }).enabled !== false };
    },
  });
}

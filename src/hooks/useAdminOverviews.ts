import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RlsTable {
  table: string;
  rls_enabled: boolean;
  policies: number;
}

export interface StorageBucketInfo {
  id: string;
  public: boolean;
  file_size_limit: number | null;
  objects: number;
  bytes: number;
}

/** Every table of the public schema with its row-level security state and policy count (administrators only). */
export function useRlsOverview() {
  return useQuery({
    queryKey: ['admin-rls-overview'],
    queryFn: async (): Promise<RlsTable[]> => {
      const { data, error } = await supabase.rpc('admin_rls_overview');
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as RlsTable[];
    },
    staleTime: 60_000,
  });
}

/** Every storage bucket with its size limit, number of files and total size (administrators only). */
export function useStorageOverview() {
  return useQuery({
    queryKey: ['admin-storage-overview'],
    queryFn: async (): Promise<StorageBucketInfo[]> => {
      const { data, error } = await supabase.rpc('admin_storage_overview');
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as StorageBucketInfo[];
    },
    staleTime: 60_000,
  });
}

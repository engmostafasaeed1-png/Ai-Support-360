import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  user_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  user_email?: string;
}

async function fetchAuditLogs(search: string, actionFilter: string) {
  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (actionFilter !== 'all') {
    query = query.ilike('action', `${actionFilter}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Fetch profile emails for user_ids
  const userIds = [...new Set((data || []).map(l => l.user_id).filter(Boolean))] as string[];
  const profileMap: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', userIds);

    if (profiles) {
      profiles.forEach(p => {
        profileMap[p.user_id] = p.display_name || 'Unknown';
      });
    }
  }

  let logs: AuditLogEntry[] = (data || []).map(row => ({
    id: row.id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    user_id: row.user_id,
    metadata: row.metadata as Record<string, any> | null,
    created_at: row.created_at,
    user_email: row.user_id ? (profileMap[row.user_id] || row.user_id) : 'system',
  }));

  if (search) {
    const s = search.toLowerCase();
    logs = logs.filter(l =>
      l.action.toLowerCase().includes(s) ||
      (l.user_email || '').toLowerCase().includes(s) ||
      (l.entity_type || '').toLowerCase().includes(s) ||
      (l.entity_id || '').toLowerCase().includes(s)
    );
  }

  return logs;
}

export function useAuditLogs(search: string, actionFilter: string) {
  return useQuery({
    queryKey: ['audit-logs', search, actionFilter],
    queryFn: () => fetchAuditLogs(search, actionFilter),
    refetchInterval: 30000,
  });
}

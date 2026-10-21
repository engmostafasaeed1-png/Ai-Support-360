import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import type { FeedbackPriority, FeedbackSeverity, FeedbackStatus, FeedbackType } from '@/lib/feedback';

const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);
const from = (table: string) => (supabase as any).from(table);

export interface MyFeedbackItem {
  id: string; created_at: string; updated_at: string; type: FeedbackType; severity: FeedbackSeverity | null;
  title: string; status: FeedbackStatus;
  updates: Array<{ kind: 'status' | 'reply' | 'submitted'; to_value: string | null; message: string | null; created_at: string }>;
}

export function useMyFeedback() {
  const { signedIn } = useSessionReady();
  return useQuery({
    queryKey: ['my-feedback'],
    enabled: signedIn,
    queryFn: async (): Promise<{ installed: boolean; items: MyFeedbackItem[] }> => {
      const { data, error } = await rpc('my_feedback');
      if (error) return { installed: false, items: [] };
      return { installed: true, items: (data ?? []) as MyFeedbackItem[] };
    },
  });
}

export interface AdminFeedbackRow {
  id: string; created_at: string; updated_at: string; user_id: string | null; tenant_id: string | null; role: string;
  type: FeedbackType; severity: FeedbackSeverity | null; title: string; description: string; route: string;
  context: Record<string, unknown> | null; contact_email: string | null; consent_contact: boolean;
  status: FeedbackStatus; priority: FeedbackPriority; assigned_to: string | null; admin_notes: string | null;
  duplicate_of: string | null; attachments: number;
}

export interface AdminFeedbackFilters {
  status: string; type: string; severity: string; role: string; search: string; page: number;
}

export const ADMIN_FEEDBACK_PAGE = 25;

export function useAdminFeedback(f: AdminFeedbackFilters) {
  return useQuery({
    queryKey: ['admin-feedback', f],
    queryFn: async (): Promise<{ installed: boolean; rows: AdminFeedbackRow[]; total: number }> => {
      let q = from('feedback_reports').select('*', { count: 'exact' }).order('created_at', { ascending: false })
        .range(f.page * ADMIN_FEEDBACK_PAGE, f.page * ADMIN_FEEDBACK_PAGE + ADMIN_FEEDBACK_PAGE - 1);
      if (f.status === 'open') q = q.in('status', ['new', 'triaged', 'in_progress']);
      else if (f.status !== 'all') q = q.eq('status', f.status);
      if (f.type !== 'all') q = q.eq('type', f.type);
      if (f.severity !== 'all') q = q.eq('severity', f.severity);
      if (f.role !== 'all') q = q.eq('role', f.role);
      const s = f.search.trim().replace(/[%,()*\\]/g, ' ').slice(0, 80);
      if (s) q = q.or(`title.ilike.%${s}%,description.ilike.%${s}%,route.ilike.%${s}%`);
      const { data, error, count } = await q;
      if (error) return { installed: false, rows: [], total: 0 };
      return { installed: true, rows: (data ?? []) as AdminFeedbackRow[], total: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

export function useAdminFeedbackCounts() {
  return useQuery({
    queryKey: ['admin-feedback-counts'],
    queryFn: async (): Promise<Record<string, number> | null> => {
      const { data, error } = await rpc('feedback_admin_counts');
      return error ? null : (data as Record<string, number>);
    },
  });
}

export function useFeedbackDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin-feedback-detail', id],
    enabled: !!id,
    gcTime: 0,
    queryFn: async () => {
      const [{ data: events }, { data: files }] = await Promise.all([
        from('feedback_events').select('id, created_at, actor_id, kind, from_value, to_value, message, visible_to_user, emailed_at')
          .eq('report_id', id).order('created_at'),
        from('feedback_attachments').select('id, path, content_type, size, created_at, deleted_at').eq('report_id', id),
      ]);
      // Short-lived links, made only for administrators (the storage rule allows nobody else).
      const live = (files ?? []).filter((f: any) => !f.deleted_at);
      const urls = await Promise.all(live.map(async (f: any) => {
        const { data } = await supabase.storage.from('feedback').createSignedUrl(f.path, 600);
        return { ...f, url: data?.signedUrl ?? null };
      }));
      return { events: (events ?? []) as any[], files: urls, removed: (files ?? []).length - live.length };
    },
  });
}

export async function updateFeedback(ids: string[], patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const { error } = await rpc('feedback_admin_update', { _ids: ids, _patch: patch });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function replyToFeedback(id: string, message: string, email: boolean): Promise<{ ok: boolean; emailed?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('feedback', { body: { action: 'reply', id, message, email } });
  if (error) {
    let code = 'reply_failed';
    try { code = (await (error as any).context?.json?.())?.error ?? code; } catch { /* generic */ }
    return { ok: false, error: code };
  }
  return { ok: true, emailed: (data as any)?.emailed };
}

export async function logFeedbackExport(count: number, filters: Record<string, unknown>): Promise<boolean> {
  const { error } = await rpc('feedback_admin_log_export', { _count: count, _filters: filters });
  return !error;
}

/** Administrators who may be assigned a report. */
export function useFeedbackAssignees(enabled: boolean) {
  return useQuery({
    queryKey: ['feedback-assignees'],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data: roles } = await from('user_roles').select('user_id, role').in('role', ['admin', 'super_admin']);
      const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id as string)));
      if (!ids.length) return [];
      const { data: profiles } = await from('profiles').select('user_id, display_name').in('user_id', ids);
      const names = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
      return ids.map((id) => ({ id, name: (names.get(id) as string) || 'Admin' }));
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';

// Called on the client object itself: a detached rpc method loses its binding.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export class BulkError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}
export async function bmRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new BulkError(error.message || 'The request failed', error.code);
  return data as T;
}

export interface BulkSettings {
  enabled: boolean;
  inapp_per_minute: number;
  telegram_per_minute: number;
  daily_cap: number;
  provider: string;
  can_edit: boolean;
  pause_installed: boolean;
  groups_installed: boolean;
  /** After docs/sql/notice-channels.sql: Web Push is a campaign channel (and the platform push keys exist). */
  push_channel?: boolean;
  push_ready?: boolean;
  push_per_minute?: number;
}
export type AccessState = { state: 'loading' } | { state: 'not_installed' } | { state: 'denied' } | { state: 'ready'; settings: BulkSettings };

export const BM_KEYS = {
  access: ['bm', 'access'], campaigns: ['bm', 'campaigns'], templates: ['bm', 'templates'], audiences: ['bm', 'audiences'],
  groups: ['bm', 'groups'], report: (id: string) => ['bm', 'report', id], manual: (id: string) => ['bm', 'manual', id],
};

/** Whether this admin may send bulk messages (database permission messages.send) and the current settings. */
export function useBulkAccess(): AccessState {
  const { signedIn } = useSessionReady();
  const q = useQuery({
    queryKey: BM_KEYS.access,
    enabled: signedIn,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<AccessState> => {
      const { data, error } = await db.rpc('bm_settings');
      if (!error) return { state: 'ready', settings: data as BulkSettings };
      if (error.code === '42501') return { state: 'denied' };
      return { state: 'not_installed' };
    },
  });
  return q.data ?? { state: 'loading' };
}

export interface Campaign {
  id: string; created_by: string; status: 'scheduled' | 'sending' | 'sent' | 'cancelled'; category: 'service' | 'marketing';
  channels: string[]; subject_en: string; subject_ar: string | null; body_en: string; body_ar: string | null; link_url: string | null;
  audience: Record<string, unknown>; recipient_count: number; excluded_count: number; scheduled_at: string; time_zone: string;
  started_at: string | null; finished_at: string | null; cancelled_at: string | null; created_at: string;
}

export function useCampaigns(enabled: boolean) {
  return useQuery({
    queryKey: BM_KEYS.campaigns,
    enabled,
    refetchInterval: 20_000,
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await db.from('message_campaigns').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw new BulkError(error.message);
      return data ?? [];
    },
  });
}

export interface Template { id: string; name: string; category: 'service' | 'marketing'; subject_en: string; subject_ar: string | null; body_en: string; body_ar: string | null; link_url: string | null; updated_at: string }
export function useTemplates(enabled: boolean) {
  return useQuery({
    queryKey: BM_KEYS.templates,
    enabled,
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await db.from('message_templates').select('*').is('archived_at', null).order('name');
      if (error) throw new BulkError(error.message);
      return data ?? [];
    },
  });
}

export interface SavedAudience { id: string; name: string; audience: Record<string, unknown> }
export function useSavedAudiences(enabled: boolean) {
  return useQuery({
    queryKey: BM_KEYS.audiences,
    enabled,
    queryFn: async (): Promise<SavedAudience[]> => {
      const { data, error } = await db.from('message_saved_audiences').select('id, name, audience').order('name');
      if (error) throw new BulkError(error.message);
      return data ?? [];
    },
  });
}

export interface ClientGroup { id: string; name: string; company: string | null; members: number }
export function useClientGroups(enabled: boolean) {
  return useQuery({ queryKey: BM_KEYS.groups, enabled, queryFn: () => bmRpc<ClientGroup[]>('bm_client_groups') });
}

export interface PreviewRecipient { user_id: string; name: string; role: string | null; lang: 'en' | 'ar'; country: string | null; telegram: boolean; has_phone: boolean; excluded: string | null }
export interface AudiencePreview {
  candidates: number; eligible: number; unknown_emails: number; excluded: Record<string, number>;
  telegram_linked: number; with_phone: number; arabic: number; recipients: PreviewRecipient[]; sent_today: number; daily_cap: number;
  push_enabled?: number;
}

export interface CampaignReport {
  by_channel: Record<string, Record<string, number>>; reasons: Record<string, number>; read: number;
  events: Array<{ action: string; at: string; actor: string | null; detail: Record<string, unknown> }>;
}
export function useCampaignReport(id: string | null) {
  return useQuery({ queryKey: BM_KEYS.report(id ?? ''), enabled: !!id, refetchInterval: 15_000, queryFn: () => bmRpc<CampaignReport>('bm_campaign_report', { _id: id }) });
}

export interface ManualContact { user_id: string; display_name: string; lang: 'en' | 'ar'; channel: 'whatsapp_manual' | 'sms_manual'; status: 'manual_pending' | 'manual_sent'; phone: string | null; first_name: string | null; company: string | null }
/** Phone numbers: loaded only on request, never cached beyond this screen, every load is recorded. */
export function useManualContacts(id: string | null, open: boolean) {
  return useQuery({
    queryKey: BM_KEYS.manual(id ?? ''), enabled: !!id && open, gcTime: 0, staleTime: Infinity, retry: false,
    queryFn: () => bmRpc<ManualContact[]>('bm_manual_contacts', { _id: id }),
  });
}

export function useBulkActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['bm'] });
  return {
    preview: (audience: unknown, category: string, exclude: string[]) => bmRpc<AudiencePreview>('bm_preview', { _audience: audience, _category: category, _exclude: exclude }),
    create: useMutation({ mutationFn: (payload: Record<string, unknown>) => bmRpc<{ id: string; recipient_count: number }>('bm_create_campaign', { _payload: payload }), onSuccess: refresh }),
    test: (subject: string, body: string, category: string) => bmRpc('bm_send_test', { _subject: subject, _body: body, _category: category }),
    cancel: useMutation({ mutationFn: (id: string) => bmRpc<{ stopped: number }>('bm_cancel_campaign', { _id: id }), onSuccess: refresh }),
    markManual: (id: string, user: string, channel: string, sent: boolean) => bmRpc('bm_mark_manual', { _id: id, _user: user, _channel: channel, _sent: sent }),
    logExport: (id: string, count: number) => bmRpc('bm_log_phone_export', { _id: id, _count: count }),
    saveTemplate: useMutation({ mutationFn: (payload: Record<string, unknown>) => bmRpc<string>('bm_save_template', { _payload: payload }), onSuccess: refresh }),
    archiveTemplate: useMutation({ mutationFn: (id: string) => bmRpc('bm_archive_template', { _id: id }), onSuccess: refresh }),
    saveAudience: useMutation({ mutationFn: (v: { name: string; audience: unknown }) => bmRpc<string>('bm_save_audience', { _name: v.name, _audience: v.audience }), onSuccess: refresh }),
    deleteAudience: useMutation({ mutationFn: (id: string) => bmRpc('bm_delete_audience', { _id: id }), onSuccess: refresh }),
    setSettings: useMutation({ mutationFn: (payload: Record<string, unknown>) => bmRpc<BulkSettings>('bm_set_settings', { _payload: payload }), onSuccess: refresh }),
  };
}

// ---------------------------------------------------------------- recipients ("Messages from AI Support 360")
export interface BroadcastMessage { notification_id: string; subject: string; body: string; category: 'service' | 'marketing'; link_url: string | null; lang: 'en' | 'ar'; sent_at?: string }

export function useBroadcastMessage(notificationId: string | null) {
  return useQuery({
    queryKey: ['bm', 'message', notificationId], enabled: !!notificationId, retry: false,
    queryFn: async (): Promise<BroadcastMessage | null> => {
      const { data, error } = await db.rpc('my_broadcast_message', { _notification_id: notificationId });
      if (error) return null;
      return (data as BroadcastMessage) ?? null;
    },
  });
}

/** Unread pop-up messages for the signed-in user; absent (null) until the prepared update is applied. */
export function useBroadcastPopups(enabled: boolean) {
  return useQuery({
    queryKey: ['bm', 'popups'], enabled, retry: false, staleTime: 60_000,
    refetchInterval: (q) => (q.state.data ? 5 * 60_000 : false),
    queryFn: async (): Promise<BroadcastMessage[] | null> => {
      const { data, error } = await db.rpc('my_broadcast_popups');
      if (error) return null;
      return (data as BroadcastMessage[]) ?? [];
    },
  });
}

export async function markNotificationRead(id: string) {
  await db.from('notifications').update({ is_read: true }).eq('id', id);
}

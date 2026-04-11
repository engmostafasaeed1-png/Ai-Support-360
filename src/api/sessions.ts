import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type SessionInsert = Database['public']['Tables']['sessions']['Insert'];
type SessionStatus = Database['public']['Tables']['sessions']['Row']['status'];

export const sessionsApi = {
  getByClient: (clientId: string) =>
    supabase.from('sessions')
      .select('id, status, scheduled_at, duration_minutes, consultant_id, session_type, meeting_url')
      .eq('client_id', clientId)
      .order('scheduled_at', { ascending: false }),

  getById: (id: string) =>
    supabase.from('sessions').select('*').eq('id', id).single(),

  create: (data: SessionInsert) =>
    supabase.from('sessions').insert(data).select().single(),

  updateStatus: (id: string, status: SessionStatus) =>
    supabase.from('sessions').update({ status }).eq('id', id),
};

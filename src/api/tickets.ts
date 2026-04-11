import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type TicketInsert = Database['public']['Tables']['tickets']['Insert'];
type TicketStatus = Database['public']['Tables']['tickets']['Row']['status'];

export const ticketsApi = {
  getByClient: (clientId: string) =>
    supabase.from('tickets')
      .select('id, title, status, urgency, sap_module, created_at, updated_at, description, assigned_to, client_id, consultant_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),

  getById: (id: string) =>
    supabase.from('tickets').select('*').eq('id', id).single(),

  create: (data: TicketInsert) =>
    supabase.from('tickets').insert(data).select().single(),

  updateStatus: (id: string, status: TicketStatus) =>
    supabase.from('tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', id),

  delete: (id: string) =>
    supabase.from('tickets').delete().eq('id', id),
};

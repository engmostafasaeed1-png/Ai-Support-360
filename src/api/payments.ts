import { supabase } from '@/integrations/supabase/client';

export const paymentsApi = {
  getByClient: (clientId: string) =>
    supabase.from('payments')
      .select('id, amount, status, created_at, description, currency, invoice_url')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),

  getById: (id: string) =>
    supabase.from('payments').select('*').eq('id', id).single(),

  create: (data: Record<string, unknown>) =>
    supabase.from('payments').insert(data).select().single(),
};

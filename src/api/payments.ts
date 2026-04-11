import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type PaymentInsert = Database['public']['Tables']['payments']['Insert'];

export const paymentsApi = {
  getByClient: (clientId: string) =>
    supabase.from('payments')
      .select('id, amount, status, created_at, description, currency, invoice_url')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),

  getById: (id: string) =>
    supabase.from('payments').select('*').eq('id', id).single(),

  create: (data: PaymentInsert) =>
    supabase.from('payments').insert(data).select().single(),
};

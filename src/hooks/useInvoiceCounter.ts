import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { toInvoiceCounterInfo, type InvoiceCounterInfo } from '@/lib/invoiceCounter';

export const INVOICE_COUNTER_KEY = ['admin-invoice-counter'] as const;

/** The counter of the invoice numbers. Only administrators can read it (the database function refuses everybody else). */
export function useInvoiceCounter() {
  return useQuery({
    queryKey: INVOICE_COUNTER_KEY,
    queryFn: async (): Promise<InvoiceCounterInfo> => {
      const { data, error } = await supabase.rpc('admin_get_invoice_counter');
      if (error) throw error;
      return toInvoiceCounterInfo(data);
    },
    // invoices are created all the time: always show the real number when the screen opens
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Moves the counter. The database checks the number again, refuses a number that an invoice of this year already has and keeps the history. */
export function useSetInvoiceCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { next: number; reason: string }): Promise<InvoiceCounterInfo> => {
      const { data, error } = await supabase.rpc('admin_set_invoice_counter', {
        _next: params.next,
        _reason: params.reason.trim(),
      });
      if (error) throw error;
      return toInvoiceCounterInfo(data);
    },
    onSuccess: (info) => {
      qc.setQueryData(INVOICE_COUNTER_KEY, info);
      toast.success(`The counter was changed. The next invoice will be ${info.next_invoice_number}.`);
    },
    onError: (err: Error) => {
      void qc.invalidateQueries({ queryKey: INVOICE_COUNTER_KEY });
      toast.error('The counter was not changed', { description: err.message });
    },
  });
}

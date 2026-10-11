import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  cleanSellerDetails,
  normaliseBillingForm,
  toBillingForm,
  toInvoiceDocument,
  toSellerDetails,
  type BillingForm,
  type InvoiceDocument,
  type SellerDetails,
} from '@/lib/businessInvoice';

export const billingDetailsKey = (tenantId: string | null | undefined) => ['tenant-billing-details', tenantId ?? null] as const;
export const invoiceDocumentKey = (paymentId: string | null | undefined) => ['invoice-document', paymentId ?? null] as const;
export const SELLER_DETAILS_KEY = ['invoice-seller-details'] as const;

/** The business details of a company. The members of the company and the administrators can read them. */
export function useTenantBillingDetails(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: billingDetailsKey(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<{ form: BillingForm; saved: boolean }> => {
      const { data, error } = await supabase
        .from('tenant_billing_details')
        .select('*')
        .eq('tenant_id', tenantId as string)
        .maybeSingle();
      if (error) throw error;
      return { form: toBillingForm(data as Record<string, unknown> | null), saved: !!data };
    },
  });
}

/** Saves the business details of a company. Only an owner or an administrator of the company can: the database checks it again. */
export function useSaveTenantBillingDetails(tenantId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: BillingForm) => {
      if (!tenantId) throw new Error('Choose a company first');
      const { error } = await supabase.rpc('save_tenant_billing_details', {
        _tenant_id: tenantId,
        _details: normaliseBillingForm(form),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingDetailsKey(tenantId) });
      toast.success('The business details were saved');
    },
    onError: (err: Error) => toast.error('The business details were not saved', { description: err.message }),
  });
}

/** Re-issues one invoice with the saved business details of its company: the number and the amounts stay, the invoice gets a new revision. */
export function useReissueInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paymentId: string) => {
      const { data, error } = await supabase.rpc('reissue_invoice_with_business_details', { _payment_id: paymentId });
      if (error) throw error;
      return data as { invoice_number?: string; revision?: number } | null;
    },
    onSuccess: (data, paymentId) => {
      void qc.invalidateQueries({ queryKey: ['client-payments'] });
      void qc.invalidateQueries({ queryKey: invoiceDocumentKey(paymentId) });
      toast.success(`${data?.invoice_number ?? 'The invoice'} was re-issued with your business details`);
    },
    onError: (err: Error) => toast.error('The invoice was not changed', { description: err.message }),
  });
}

/** Re-issues several invoices one after the other and tells the result in one message. */
export function useReissueInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoices: { id: string; invoice: string }[]) => {
      const failed: { invoice: string; message: string }[] = [];
      let done = 0;
      for (const inv of invoices) {
        const { error } = await supabase.rpc('reissue_invoice_with_business_details', { _payment_id: inv.id });
        if (error) failed.push({ invoice: inv.invoice, message: error.message });
        else done += 1;
      }
      return { done, failed };
    },
    onSuccess: ({ done, failed }) => {
      void qc.invalidateQueries({ queryKey: ['client-payments'] });
      if (failed.length === 0) {
        toast.success(`${done} invoice${done === 1 ? '' : 's'} re-issued with your business details`);
      } else {
        toast.error(`${done} re-issued, ${failed.length} not changed`, { description: `${failed[0].invoice}: ${failed[0].message}` });
      }
    },
    onError: (err: Error) => toast.error('The invoices were not changed', { description: err.message }),
  });
}

export type InvoiceDocumentResult =
  | { ok: true; doc: InvoiceDocument }
  | { ok: false; reason: 'not_found' | 'no_access'; message: string };

/**
 * Everything the printable invoice page shows. The customer of the invoice and the administrators can read it.
 * "Not found" and "no access" come back as a result, not as an error, because a wrong link is a normal case and no problem of the app.
 */
export function useInvoiceDocument(paymentId: string | undefined) {
  return useQuery({
    queryKey: invoiceDocumentKey(paymentId),
    enabled: !!paymentId,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<InvoiceDocumentResult> => {
      const { data, error } = await supabase.rpc('get_invoice_document', { _payment_id: paymentId as string });
      if (error) {
        if (error.code === '42704') return { ok: false, reason: 'not_found', message: error.message };
        if (error.code === '42501') return { ok: false, reason: 'no_access', message: error.message };
        throw error;
      }
      return { ok: true, doc: toInvoiceDocument(data) };
    },
  });
}

/** The company that issues the invoices (its legal name, address, tax number ...). Every signed-in user can read it. */
export function useInvoiceSellerDetails() {
  return useQuery({
    queryKey: SELLER_DETAILS_KEY,
    queryFn: async (): Promise<SellerDetails> => {
      const { data, error } = await supabase.rpc('get_invoice_seller_details');
      if (error) throw error;
      return toSellerDetails(data);
    },
  });
}

/** An administrator changes the seller details that are printed on every invoice. */
export function useSaveInvoiceSellerDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (details: SellerDetails): Promise<SellerDetails> => {
      const { data, error } = await supabase.rpc('admin_save_invoice_seller_details', { _details: cleanSellerDetails(details) });
      if (error) throw error;
      return toSellerDetails(data);
    },
    onSuccess: (saved) => {
      qc.setQueryData(SELLER_DETAILS_KEY, saved);
      void qc.invalidateQueries({ queryKey: ['invoice-document'] });
      toast.success('The seller details were saved');
    },
    onError: (err: Error) => toast.error('The seller details were not saved', { description: err.message }),
  });
}

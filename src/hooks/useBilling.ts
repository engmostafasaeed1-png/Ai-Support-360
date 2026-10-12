import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// The billing tables and functions are new: these hooks talk to them untyped on purpose.
const db = supabase as any;

export type BankDetails = {
  beneficiary?: string;
  bank_name?: string;
  iban?: string;
  account_number?: string;
  swift?: string;
  currency?: string;
  country?: string;
  instructions?: string;
};

export type PayoutDetails = {
  consultant_id: string;
  account_holder: string;
  bank_name: string;
  iban: string | null;
  account_number: string | null;
  swift_bic: string | null;
  country: string | null;
  currency: string;
  notes: string | null;
  verified_at: string | null;
  acknowledged_at?: string | null;
  acknowledged_version?: string | null;
  updated_at?: string;
};

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const fail = (title: string) => (e: unknown) =>
  toast.error(title, { description: e instanceof Error ? e.message : undefined });

/* ---------------------------------------------------------------- names */

async function loadNames(clientIds: string[], consultantIds: string[]) {
  const consultantUsers: Record<string, string> = {};
  if (consultantIds.length > 0) {
    const { data } = await db.from('consultants').select('id, user_id').in('id', consultantIds);
    (data ?? []).forEach((c: any) => { consultantUsers[c.id] = c.user_id; });
  }
  const userIds = [...new Set([...clientIds, ...Object.values(consultantUsers)])];
  const people: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data } = await db.from('profiles').select('user_id, display_name').in('user_id', userIds);
    (data ?? []).forEach((p: any) => { people[p.user_id] = p.display_name || ''; });
  }
  const clients: Record<string, string> = {};
  clientIds.forEach((id) => { clients[id] = people[id] || 'Client'; });
  const consultants: Record<string, string> = {};
  Object.entries(consultantUsers).forEach(([cid, uid]) => { consultants[cid] = people[uid] || 'Consultant'; });
  return { clients, consultants };
}

/* --------------------------------------------------------------- client */

export function usePaymentInstructions(enabled = true) {
  return useQuery({
    queryKey: ['payment-instructions'],
    enabled,
    queryFn: () => rpc<BankDetails | null>('get_payment_instructions'),
  });
}

export function useReportPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { paymentId: string; reference: string; date: string; note?: string }) =>
      rpc('client_report_payment', {
        _payment_id: v.paymentId,
        _transfer_reference: v.reference,
        _transfer_date: v.date,
        _note: v.note?.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Thank you. We have your report and confirm it when the money arrives.');
      qc.invalidateQueries({ queryKey: ['client-payments'] });
    },
    onError: fail('Could not report the payment'),
  });
}

/* ----------------------------------------------------------------- card */

export type ProviderEvent = {
  id: string;
  created_at: string;
  kind: string;
  amount: number | null;
  currency: string | null;
  outcome: string | null;
  detail: string | null;
  delivered_via: string;
  order_id: string | null;
  transaction_id: string | null;
};

export type PaymobStatus = {
  ok: boolean;
  configured: { secret_key: boolean; public_key: boolean; hmac_secret: boolean; card_integration_id: boolean };
  mode: 'test' | 'live' | 'unknown';
  modes_match: boolean;
  webhook_url: string;
  return_url: string;
};

/** The edge functions answer with JSON; the message in it is what the person should read. */
async function functionMessage(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.provider_message ? `${body.error} (${body.provider_message})` : String(body.error);
  } catch {
    // not JSON: use the generic text below
  }
  return error?.message || 'Request failed';
}

export function useCardPaymentsEnabled(enabled = true) {
  return useQuery({
    queryKey: ['card-payments-enabled'],
    enabled,
    staleTime: 60_000,
    queryFn: () => rpc<boolean>('card_payments_enabled'),
  });
}

export function useStartCardPayment() {
  return useMutation({
    mutationFn: async (paymentId: string) => {
      const { data, error } = await supabase.functions.invoke('paymob-create-payment', { body: { action: 'create', payment_id: paymentId } });
      if (error) throw new Error(await functionMessage(error));
      const url = data?.checkout_url;
      if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('The card payment could not be started');
      return url;
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
    onError: fail('Could not start the card payment'),
  });
}

export function usePaymobStatus(enabled = true) {
  return useQuery({
    queryKey: ['paymob-status'],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('paymob-create-payment', { body: { action: 'status' } });
      if (error) throw new Error(await functionMessage(error));
      return data as PaymobStatus;
    },
  });
}

export function useProviderEvents(enabled = true) {
  return useQuery({
    queryKey: ['provider-events'],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from('payment_provider_events')
        .select('id, created_at, kind, amount, currency, outcome, detail, delivered_via, order_id, transaction_id')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProviderEvent[];
    },
  });
}

/* ----------------------------------------------------------- consultant */

export function useMyPayoutDetails() {
  return useQuery({
    queryKey: ['my-payout-details'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: consultant } = await db.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) return null;
      const { data } = await db.from('consultant_payout_details')
        .select('account_holder, bank_name, iban, account_number, swift_bic, country, currency, notes, verified_at, acknowledged_at, acknowledged_version, updated_at')
        .eq('consultant_id', consultant.id).maybeSingle();
      return { consultantId: consultant.id as string, details: (data ?? null) as PayoutDetails | null };
    },
  });
}

export function useSavePayoutDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      account_holder: string; bank_name: string; iban: string; account_number: string; swift_bic: string;
      country: string; currency: string; notes: string; acknowledged: boolean; ackVersion: string;
    }) => {
      const { error } = await db.rpc('save_payout_details', {
        _account_holder: v.account_holder,
        _bank_name: v.bank_name,
        _iban: v.iban,
        _account_number: v.account_number,
        _swift_bic: v.swift_bic,
        _country: v.country,
        _currency: v.currency,
        _notes: v.notes,
        _acknowledged: v.acknowledged,
        _ack_version: v.ackVersion,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Bank details saved.');
      qc.invalidateQueries({ queryKey: ['my-payout-details'] });
    },
    onError: (e: unknown) => { toast.error(e instanceof Error ? e.message : 'Could not save the bank details'); },
  });
}

/** Admin: Missing / Waiting / Verified for every consultant, without the numbers. One call per page. */
export function useAdminPayoutStatus() {
  return useQuery({
    queryKey: ['admin-payout-status'],
    queryFn: async () => {
      const { data, error } = await db.rpc('admin_payout_details_status');
      if (error) throw new Error(error.message);
      return (data ?? []) as import('@/lib/payoutStatus').PayoutStatusRow[];
    },
  });
}

/* ---------------------------------------------------------------- admin */

export function useAdminInvoices() {
  return useQuery({
    queryKey: ['admin-invoices'],
    queryFn: async () => {
      const { data, error } = await db.from('payments').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      const rows: any[] = data ?? [];
      const clientIds = [...new Set(rows.map((r) => r.client_id as string))];
      const consultantIds = [...new Set(rows.map((r) => r.consultant_id as string).filter(Boolean))];
      const names = await loadNames(clientIds, consultantIds);
      return rows.map((r) => ({
        ...r,
        client_name: names.clients[r.client_id] || 'Client',
        consultant_name: r.consultant_id ? names.consultants[r.consultant_id] || 'Consultant' : null,
      }));
    },
  });
}

export function useAdminPayouts() {
  return useQuery({
    queryKey: ['admin-payouts'],
    queryFn: async () => {
      const { data, error } = await db.from('payouts').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      const rows: any[] = data ?? [];
      const consultantIds = [...new Set(rows.map((r) => r.consultant_id as string))];
      const names = await loadNames([], consultantIds);
      const detailsMap: Record<string, { verified_at: string | null }> = {};
      if (consultantIds.length > 0) {
        const { data: details } = await db.from('consultant_payout_details').select('consultant_id, verified_at').in('consultant_id', consultantIds);
        (details ?? []).forEach((d: any) => { detailsMap[d.consultant_id] = { verified_at: d.verified_at }; });
      }
      return rows.map((r) => ({
        ...r,
        consultant_name: names.consultants[r.consultant_id] || 'Consultant',
        has_details: !!detailsMap[r.consultant_id],
        details_verified: !!detailsMap[r.consultant_id]?.verified_at,
      }));
    },
  });
}

export function useConsultantPayoutDetails(consultantId: string | null) {
  return useQuery({
    queryKey: ['consultant-payout-details', consultantId],
    enabled: !!consultantId,
    queryFn: async () => {
      const { data, error } = await db.from('consultant_payout_details').select('*').eq('consultant_id', consultantId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as PayoutDetails | null;
    },
  });
}

export function useVerifyPayoutDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (consultantId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await db.from('consultant_payout_details')
        .update({ verified_at: new Date().toISOString(), verified_by: user?.id ?? null })
        .eq('consultant_id', consultantId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, consultantId) => {
      toast.success('Bank details marked as verified');
      qc.invalidateQueries({ queryKey: ['consultant-payout-details', consultantId] });
      qc.invalidateQueries({ queryKey: ['admin-payouts'] });
    },
    onError: fail('Could not verify the bank details'),
  });
}

export function usePaymentSettings() {
  return useQuery({
    queryKey: ['payment-settings'],
    queryFn: async () => {
      const { data, error } = await db.from('platform_settings').select('key, value')
        .in('key', ['commission_percent', 'vat_percent', 'service_fee_percent', 'processing_fee_percent', 'subscription_plans_enabled', 'platform_bank_details', 'card_payments_enabled']);
      if (error) throw new Error(error.message);
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.key] = r.value; });
      const num = (v: any) => (v === undefined || v === null || v === '' ? null : Number(v));
      return {
        commission: num(map.commission_percent),
        vat: num(map.vat_percent),
        bank: (map.platform_bank_details && typeof map.platform_bank_details === 'object' ? map.platform_bank_details : {}) as BankDetails,
        cards: map.card_payments_enabled === true,
        serviceFee: num(map.service_fee_percent),
        processingFee: num(map.processing_fee_percent),
        plans: map.subscription_plans_enabled === true,
      };
    },
  });
}

export function useSavePaymentSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: 'commission_percent' | 'vat_percent' | 'service_fee_percent' | 'processing_fee_percent' | 'subscription_plans_enabled' | 'platform_bank_details' | 'card_payments_enabled'; value: unknown }) => {
      const { error } = await db.from('platform_settings').upsert({ key: v.key, value: v.value }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['payment-settings'] });
      qc.invalidateQueries({ queryKey: ['pricing-terms'] });
      qc.invalidateQueries({ queryKey: ['payment-instructions'] });
      qc.invalidateQueries({ queryKey: ['card-payments-enabled'] });
      qc.invalidateQueries({ queryKey: ['bank-account-log'] });
    },
    onError: fail('Could not save'),
  });
}

/** Saves the three percentages of the price (platform service fee, payment processing fee, VAT) in one step. */
export function useSavePricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { service: number; processing: number; vat: number }) => {
      const { error } = await db.from('platform_settings').upsert(
        [
          { key: 'service_fee_percent', value: v.service },
          { key: 'processing_fee_percent', value: v.processing },
          { key: 'vat_percent', value: v.vat },
        ],
        { onConflict: 'key' },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Pricing saved. It applies to the timesheets that are approved from now on.');
      qc.invalidateQueries({ queryKey: ['payment-settings'] });
      qc.invalidateQueries({ queryKey: ['pricing-terms'] });
    },
    onError: fail('Could not save the pricing'),
  });
}

function useBillingAction<V>(run: (v: V) => Promise<unknown>, okMessage: string, failTitle: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      toast.success(okMessage);
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      qc.invalidateQueries({ queryKey: ['admin-payouts'] });
    },
    onError: fail(failTitle),
  });
}

export const useConfirmPayment = () =>
  useBillingAction(
    (v: { id: string; bankReference: string; received?: number }) =>
      rpc('admin_confirm_payment', { _payment_id: v.id, _bank_reference: v.bankReference, _received_amount: v.received ?? null, _note: null }),
    'Payment confirmed. The consultant payout was created.',
    'Could not confirm the payment',
  );

export const useRejectReport = () =>
  useBillingAction(
    (v: { id: string; note: string }) => rpc('admin_reject_payment_report', { _payment_id: v.id, _note: v.note }),
    'The client was told that the transfer was not found.',
    'Could not answer the report',
  );

export const useSetPayoutStatus = () =>
  useBillingAction(
    (v: { id: string; status: 'pending' | 'processing' | 'completed' | 'failed'; bankReference?: string; note?: string }) =>
      rpc('admin_set_payout_status', { _payout_id: v.id, _status: v.status, _bank_reference: v.bankReference ?? null, _note: v.note ?? null }),
    'Payout updated. The consultant was told.',
    'Could not update the payout',
  );

export const useCreateInvoice = () =>
  useBillingAction(
    (v: { clientId: string; consultantId: string | null; ticketId: string | null; amount: number; currency: string; description: string; vat: number; dueDays: number }) =>
      rpc('admin_create_invoice', {
        _client_id: v.clientId,
        _consultant_id: v.consultantId,
        _ticket_id: v.ticketId,
        _amount: v.amount,
        _currency: v.currency,
        _description: v.description,
        _vat_amount: v.vat,
        _due_days: v.dueDays,
      }),
    'Invoice created. The client was told.',
    'Could not create the invoice',
  );

export function useBillingPeople(enabled: boolean) {
  return useQuery({
    queryKey: ['billing-people'],
    enabled,
    queryFn: async () => {
      const { data: roles } = await db.from('user_roles').select('user_id').eq('role', 'client').limit(300);
      const clientIds: string[] = [...new Set<string>((roles ?? []).map((r: any) => r.user_id as string))];
      const { data: cons } = await db.from('consultants').select('id').eq('verification_status', 'verified').limit(300);
      const consultantIds: string[] = (cons ?? []).map((c: any) => c.id as string);
      const names = await loadNames(clientIds, consultantIds);
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      return {
        clients: clientIds.map((id) => ({ id, name: names.clients[id] })).sort(byName),
        consultants: consultantIds.map((id) => ({ id, name: names.consultants[id] })).sort(byName),
      };
    },
  });
}

export function useClientTicketsForInvoice(clientId: string | null) {
  return useQuery({
    queryKey: ['billing-client-tickets', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await db.from('tickets').select('id, title').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50);
      return (data ?? []) as { id: string; title: string }[];
    },
  });
}

/* ------------------------------------------------ payment methods: cards first, bank transfer by permission */

export type PaymentMethods = {
  card: boolean;
  bank_transfer: boolean;
  /** why bank transfer is open: cards are off, the company was allowed or the invoice was allowed; null when it is not open */
  bank_transfer_reason: 'cards_off' | 'company' | 'invoice' | null;
};

/** The ways to pay one open invoice: the card, and bank transfer only when the administrator allowed it (or while cards are off). */
export function usePaymentMethods(paymentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payment-methods', paymentId],
    enabled: enabled && !!paymentId,
    staleTime: 30_000,
    queryFn: () => rpc<PaymentMethods>('get_payment_methods', { _payment_id: paymentId }),
  });
}

export type BankTransferCompany = {
  id: string;
  name: string;
  allowed: boolean;
  note: string | null;
  grantedAt: string | null;
  openInvoices: number;
};

/** Admin: every company with its bank-transfer permission and its number of open invoices. */
export function useBankTransferCompanies() {
  return useQuery({
    queryKey: ['bank-transfer-companies'],
    queryFn: async () => {
      const [tenants, perms, open] = await Promise.all([
        db.from('tenants').select('id, name').order('name').limit(500),
        db.from('bank_transfer_permissions').select('tenant_id, note, granted_at'),
        db.from('payments').select('tenant_id').eq('status', 'pending').not('tenant_id', 'is', null),
      ]);
      if (tenants.error) throw new Error(tenants.error.message);
      if (perms.error) throw new Error(perms.error.message);
      const allowed: Record<string, { note: string | null; granted_at: string }> = {};
      (perms.data ?? []).forEach((p: any) => { allowed[p.tenant_id] = { note: p.note, granted_at: p.granted_at }; });
      const openBy: Record<string, number> = {};
      (open.data ?? []).forEach((p: any) => { openBy[p.tenant_id] = (openBy[p.tenant_id] ?? 0) + 1; });
      return (tenants.data ?? []).map((t: any) => ({
        id: t.id as string,
        name: (t.name as string) || 'Company',
        allowed: !!allowed[t.id],
        note: allowed[t.id]?.note ?? null,
        grantedAt: allowed[t.id]?.granted_at ?? null,
        openInvoices: openBy[t.id] ?? 0,
      })) as BankTransferCompany[];
    },
  });
}

/** Admin: the invoices that were opened for bank transfer one by one (payment id -> the grant). */
export function useInvoiceBankGrants() {
  return useQuery({
    queryKey: ['invoice-bank-grants'],
    queryFn: async () => {
      const { data, error } = await db.from('invoice_bank_transfer_grants').select('payment_id, note, granted_at');
      if (error) throw new Error(error.message);
      const map: Record<string, { note: string | null; granted_at: string }> = {};
      (data ?? []).forEach((g: any) => { map[g.payment_id] = { note: g.note, granted_at: g.granted_at }; });
      return map;
    },
  });
}

export type BankTransferLogRow = {
  id: string;
  scope: 'company' | 'invoice';
  label: string;
  allowed: boolean;
  note: string | null;
  changed_at: string;
};

/** Admin: the last changes of the permission (who was allowed or stopped, and when). */
export function useBankTransferLog(limit = 8) {
  return useQuery({
    queryKey: ['bank-transfer-log', limit],
    queryFn: async () => {
      const { data, error } = await db.from('bank_transfer_permission_log')
        .select('id, scope, tenant_id, payment_id, allowed, note, changed_at')
        .order('changed_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      const rows: any[] = data ?? [];
      const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))] as string[];
      const paymentIds = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      const numbers: Record<string, string> = {};
      if (tenantIds.length > 0) {
        const { data: t } = await db.from('tenants').select('id, name').in('id', tenantIds);
        (t ?? []).forEach((x: any) => { names[x.id] = x.name; });
      }
      if (paymentIds.length > 0) {
        const { data: p } = await db.from('payments').select('id, invoice_number, reference').in('id', paymentIds);
        (p ?? []).forEach((x: any) => { numbers[x.id] = x.invoice_number || x.reference || ''; });
      }
      return rows.map((r) => ({
        id: r.id as string,
        scope: r.scope as 'company' | 'invoice',
        allowed: !!r.allowed,
        note: (r.note as string | null) ?? null,
        changed_at: r.changed_at as string,
        label: r.scope === 'invoice' ? `Invoice ${numbers[r.payment_id] || ''}`.trim() : names[r.tenant_id] || 'Company',
      })) as BankTransferLogRow[];
    },
  });
}

function useBankTransferAction<V>(run: (v: V) => Promise<unknown>, okMessage: string, failTitle: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      toast.success(okMessage);
      for (const key of ['bank-transfer-companies', 'invoice-bank-grants', 'bank-transfer-log', 'invoice-bank-accounts', 'bank-account-log', 'admin-invoices', 'payment-methods', 'payment-instructions']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: fail(failTitle),
  });
}

export const useSetCompanyBankTransfer = () =>
  useBankTransferAction(
    (v: { tenantId: string; allowed: boolean; note?: string }) =>
      rpc('admin_set_company_bank_transfer', { _tenant_id: v.tenantId, _allowed: v.allowed, _note: v.note?.trim() || null }),
    'Saved. The company was told.',
    'Could not change the permission',
  );

export const useSetInvoiceBankTransfer = () =>
  useBankTransferAction(
    (v: { paymentId: string; allowed: boolean; note?: string }) =>
      rpc('admin_set_invoice_bank_transfer', { _payment_id: v.paymentId, _allowed: v.allowed, _note: v.note?.trim() || null }),
    'Saved. The client was told.',
    'Could not change the permission',
  );

/* ------------------------------------------------ the bank account that clients pay into: all invoices, or one invoice */

/** The bank account to pay one open invoice into: its own account when the administrator set one, else the platform account. Null when the client may not pay by bank transfer. */
export function useInvoiceBankDetails(paymentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payment-instructions', paymentId],
    enabled: enabled && !!paymentId,
    queryFn: () => rpc<BankDetails | null>('get_payment_instructions', { _payment_id: paymentId }),
  });
}

/** Admin: the invoices that have an account of their own (payment id -> the account). */
export function useInvoiceBankAccounts() {
  return useQuery({
    queryKey: ['invoice-bank-accounts'],
    queryFn: async () => {
      const { data, error } = await db.from('invoice_bank_accounts').select('payment_id, details, note, set_at');
      if (error) throw new Error(error.message);
      const map: Record<string, { details: BankDetails; note: string | null; set_at: string }> = {};
      (data ?? []).forEach((a: any) => { map[a.payment_id] = { details: (a.details ?? {}) as BankDetails, note: a.note ?? null, set_at: a.set_at }; });
      return map;
    },
  });
}

export type BankAccountLogRow = {
  id: string;
  scope: 'all' | 'invoice';
  label: string;
  action: 'set' | 'removed';
  summary: string | null;
  note: string | null;
  changed_at: string;
};

/** Admin: the last changes of the bank accounts (the number is never shown in full). */
export function useBankAccountLog(limit = 8) {
  return useQuery({
    queryKey: ['bank-account-log', limit],
    queryFn: async () => {
      const { data, error } = await db.from('bank_account_change_log')
        .select('id, scope, payment_id, action, summary, note, changed_at')
        .order('changed_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      const rows: any[] = data ?? [];
      const paymentIds = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))] as string[];
      const numbers: Record<string, string> = {};
      if (paymentIds.length > 0) {
        const { data: p } = await db.from('payments').select('id, invoice_number, reference').in('id', paymentIds);
        (p ?? []).forEach((x: any) => { numbers[x.id] = x.invoice_number || x.reference || ''; });
      }
      return rows.map((r) => ({
        id: r.id as string,
        scope: r.scope as 'all' | 'invoice',
        action: r.action as 'set' | 'removed',
        summary: (r.summary as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        changed_at: r.changed_at as string,
        label: r.scope === 'invoice' ? `Invoice ${numbers[r.payment_id] || ''}`.trim() : 'All invoices',
      })) as BankAccountLogRow[];
    },
  });
}

/** Admin: gives one invoice an account of its own, or (details null) lets it use the platform account again. */
export const useSetInvoiceBankAccount = () =>
  useBankTransferAction(
    (v: { paymentId: string; details: BankDetails | null; note?: string }) =>
      rpc('admin_set_invoice_bank_account', { _payment_id: v.paymentId, _details: v.details ?? {}, _note: v.note?.trim() || null }),
    'Saved. The client was told.',
    'Could not change the bank account',
  );

// Support agreements: browser calls. Every read and write goes through the SECURITY DEFINER functions of
// docs/sql/support-agreements.sql via safeRpc (never a direct table write). Before that file is applied every call
// reports "not ready" and the screens show a short notice instead.
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { supabase } from '@/integrations/supabase/client';
import { normalizeSaSettings, saErrorCode, type SaModel, type SaSettings, type SaStatus, type SaTerms } from './model';
import type { SaRequest } from './model';

export class SaError extends Error {
  code: string;
  constructor(message: string, code = '') { super(message); this.code = code; }
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await safeRpc<T>(fn, args);
  if (error) {
    if (isMissingRpc(error)) throw new SaError('not_ready', 'not_ready');
    throw new SaError(error.message, saErrorCode(error.message));
  }
  return data as T;
}

export type SaRole = 'admin' | 'client' | 'client_member' | 'lead' | 'team' | 'applicant' | 'candidate';

export interface SaListItem {
  id: string; name: string; status: SaStatus; role: SaRole; modules: string[]; model: SaModel;
  start_date: string | null; end_date: string | null; applications: number | null; updated_at: string;
}
export interface SaMine { ready: boolean; enabled: boolean; settings: SaSettings; agreements: SaListItem[]; replacements: Array<{ id: string; agreement_id: string; name: string }> }

export interface SaApplication {
  id: string; consultant_id: string; name?: string; hourly_rate: number; currency: string; model: SaModel; capacity_hours_per_week: number | null;
  availability_note: string; sla_accepted_at: string; sla_summary: string; message: string; status: string; created_at: string;
}
export interface SaRateRecord {
  id: string; seq: number; hourly_rate: number; currency: string; s1_multiplier: number | null; ooh_multiplier: number | null; overage_rate: number | null;
  effective_from: string; proposed_role: string; version: number | null; created_at: string; content_hash?: string;
}
export interface SaUsage {
  month: string; used_hours: number; committed: number | null; capacity_hours_per_week: number | null; rollover_balance: number;
  sla: { measured: number; met: number; pct: number | null } | null; end_date: string | null; termination_end: string | null; tickets: number;
  recent: Array<{ id: string; title: string; status: string; created_at: string }>; spend: number;
  months: Array<{ month: string; used_hours: number; committed_hours: number; expired_hours: number; charge_hours: number; overage_hours: number; carried_out: unknown; payment_id: string | null; amount: number | null }>;
}
export interface SaDetail {
  id: string; name: string; status: SaStatus; role: SaRole; request: Partial<SaRequest> & { budget?: SaRequest['budget'] }; modules: string[];
  deadline: string | null; invite_only: boolean; legal_draft: boolean; created_at: string;
  terms_public: Pick<SaTerms, 'model' | 'term' | 'sla' | 'scope' | 'bank' | 'capacity_hours_per_week' | 'nda_required'>;
  // Applicants only
  my_application?: SaApplication | null;
  // Parties and admins only
  terms?: SaTerms; version?: number; content_hash?: string | null; consultant_id?: string | null; consultant_name?: string | null;
  admin_review?: 'not_needed' | 'pending' | 'approved' | 'rejected'; agreed_at?: string | null; started_at?: string | null; start_date?: string | null; end_date?: string | null;
  auto_renew?: { client: boolean; consultant: boolean };
  termination?: { by: string; reason: string; end: string; handover_until: string | null; handover_note: string | null } | null;
  suspended_until?: string | null; nda_ok?: boolean | null;
  versions?: Array<{ version: number; hash: string; note: string; at: string }>;
  acceptances?: Array<{ version: number; party: string; name: string; at: string; hash: string; legal_draft: boolean }>;
  rates?: SaRateRecord[]; rate_in_force?: SaRateRecord | null;
  rate_changes?: Array<{ id: string; by: string; hourly_rate: number; s1_multiplier: number | null; overage_rate: number | null; effective_from: string; reason: string; status: string; at: string }>;
  offers?: Array<{ id: string; by: 'client' | 'consultant'; patch: Record<string, unknown>; note: string; status: string; at: string }>;
  applications?: SaApplication[] | null;
  members?: Array<{ consultant_id: string; name?: string; role: string; status: string }>;
  replacement?: { id: string; status: string; to: string; reason: string } | null;
  events?: Array<{ kind: string; role: string | null; data: Record<string, unknown>; at: string }>;
  messages: Array<{ consultant_id?: string; role: string; body: string; at: string }>;
  usage?: SaUsage | null;
  fees?: { service_fee_percent: number; processing_fee_percent: number; vat_percent: number };
}
export interface SaOpportunity {
  id: string; name: string; request: Partial<SaRequest>; modules: string[]; model: SaModel; term: SaTerms['term']; sla: SaTerms['sla'];
  deadline: string | null; invited: boolean; applied: boolean; role: SaRole;
}
export interface SaAdminRow {
  id: string; name: string; status: SaStatus; admin_review: string; company: string | null; consultant: string | null;
  rate: { hourly_rate: number; currency: string } | null; model: SaModel; end_date: string | null; last_activity_at: string | null; inactive: boolean;
  replacement: { id: string; status: string; reason: string } | null; updated_at: string;
}

export async function fetchMine(tenant: string | null): Promise<SaMine> {
  const { data, error } = await safeRpc<Record<string, unknown>>('sa_list_mine', { _tenant: tenant });
  if (error || !data) return { ready: false, enabled: false, settings: normalizeSaSettings({}), agreements: [], replacements: [] };
  return {
    ready: true, enabled: data.enabled === true, settings: normalizeSaSettings(data.settings),
    agreements: (data.agreements as SaListItem[]) ?? [], replacements: (data.replacements as SaMine['replacements']) ?? [],
  };
}

export const fetchAgreement = (id: string) => call<SaDetail>('sa_get', { _id: id });
export const fetchOpportunities = () => call<SaOpportunity[]>('sa_opportunities');
export const fetchUsable = (tenant: string | null) => call<Array<{ id: string; name: string; modules: string[] }>>('sa_usable', { _tenant: tenant });
export const fetchTicketTags = (ids: string[]) => call<Array<{ ticket_id: string; agreement_id: string; name: string }>>('sa_ticket_tags', { _tickets: ids.slice(0, 200) });

export const createAgreement = (tenant: string | null, request: SaRequest, terms: SaTerms) => call<string>('sa_create', { _tenant: tenant, _request: request, _terms: terms });
export const saveDraft = (id: string, request: SaRequest, terms: SaTerms) => call<void>('sa_save_draft', { _id: id, _request: request, _terms: terms });
export const publish = (id: string, deadline: string | null, inviteOnly: boolean, invite: string[]) =>
  call<Record<string, unknown>>('sa_publish', { _id: id, _deadline: deadline, _invite_only: inviteOnly, _invite: invite });
export const apply = (id: string, a: { rate: number; currency: string; model: SaModel; capacity: number | null; availability: string; slaAccepted: boolean; message: string }) =>
  call<string>('sa_apply', { _id: id, _rate: a.rate, _currency: a.currency, _model: a.model, _capacity: a.capacity, _availability: a.availability, _sla_accepted: a.slaAccepted, _message: a.message });
export const withdrawApplication = (id: string) => call<void>('sa_withdraw_application', { _id: id });
export const selectApplication = (applicationId: string) => call<number>('sa_select_application', { _application: applicationId });
export const reopen = (id: string, reason: string) => call<void>('sa_reopen', { _id: id, _reason: reason });
export const makeOffer = (id: string, patch: Record<string, unknown>, note: string) => call<string>('sa_offer', { _id: id, _patch: patch, _note: note });
export const respondOffer = (offerId: string, accept: boolean) => call<number>('sa_respond_offer', { _offer: offerId, _accept: accept });
export const acceptTerms = (id: string, version: number, hash: string, typedName: string) =>
  call<Record<string, unknown>>('sa_accept_terms', { _id: id, _version: version, _hash: hash, _typed_name: typedName });
export const proposeRateChange = (id: string, a: { rate: number; s1: number | null; ooh: number | null; overage: number | null; effective: string; reason: string }) =>
  call<string>('sa_propose_rate_change', { _id: id, _rate: a.rate, _s1: a.s1, _ooh: a.ooh, _overage: a.overage, _effective: a.effective, _reason: a.reason });
export const decideRateChange = (changeId: string, accept: boolean) => call<void>('sa_decide_rate_change', { _change: changeId, _accept: accept });
export const requestTermination = (id: string, reason: string) => call<Record<string, unknown>>('sa_request_termination', { _id: id, _reason: reason });
export const saveHandoverNote = (id: string, note: string) => call<void>('sa_handover_note', { _id: id, _note: note });
export const suspend = (id: string, until: string, reason: string) => call<void>('sa_suspend', { _id: id, _until: until, _reason: reason });
export const resume = (id: string) => call<void>('sa_resume', { _id: id });
export const setAutoRenew = (id: string, on: boolean) => call<void>('sa_set_auto_renew', { _id: id, _on: on });
export const inviteMember = (id: string, consultantId: string) => call<void>('sa_invite_member', { _id: id, _consultant: consultantId });
export const memberRespond = (id: string, accept: boolean) => call<void>('sa_member_respond', { _id: id, _accept: accept });
export const requestReplacement = (id: string, to: string, reason: string) => call<string>('sa_request_replacement', { _id: id, _to: to, _reason: reason });
export const replacementAccept = (replacementId: string, accept: boolean) => call<void>('sa_replacement_accept', { _replacement: replacementId, _accept: accept });
export const postMessage = (id: string, consultantId: string | null, body: string) => call<string>('sa_post_message', { _id: id, _consultant: consultantId, _body: body });
export const attachTicket = (ticketId: string, agreementId: string) => call<{ linked: boolean }>('sa_attach_ticket', { _ticket: ticketId, _agreement: agreementId });

// Administrators
export const adminList = (status: string | null) => call<SaAdminRow[]>('sa_admin_list', { _status: status });
export const adminSaveSettings = (value: Partial<SaSettings>, reason: string) => call<Record<string, unknown>>('sa_admin_set_settings', { _value: value, _reason: reason });
export const adminReview = (id: string, approve: boolean, note: string) => call<void>('sa_admin_review', { _id: id, _approve: approve, _note: note });
export const adminDecideReplacement = (replacementId: string, approve: boolean, note: string) =>
  call<void>('sa_admin_decide_replacement', { _replacement: replacementId, _approve: approve, _note: note });

export async function sendAgreementTestEmail(lang: 'en' | 'ar') {
  const { data, error } = await supabase.functions.invoke('agreement-run', { body: { action: 'test', lang } });
  if (error) throw new SaError(error.message, 'generic');
  return data as { ok: boolean; reason?: string };
}

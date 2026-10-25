// SLA policies: browser calls. All reads and writes go through the SECURITY DEFINER functions of
// docs/sql/sla-policies.sql via safeRpc (never a direct table write). Before that file is applied every call reports
// "not ready" and the screens keep today's SLA view.
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { supabase } from '@/integrations/supabase/client';
import type { ClockRow, PolicyBody, PolicyMeta, PolicyProblem, PolicyStatus, ResolvedCalendar, SeverityKey, SlaSettings } from './policy';
import { normalizeSettings } from './policy';

export class SlaError extends Error {
  code: string;
  constructor(message: string, code = '') { super(message); this.code = code; }
}

/** Database error -> short code used for translated messages (sla_forbidden, sla_outside_bounds, ...). */
export function slaErrorCode(message: string | undefined): string {
  const m = /(sla_[a-z_]+)/.exec(message ?? '');
  return m ? m[1] : 'generic';
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await safeRpc<T>(fn, args);
  if (error) {
    if (isMissingRpc(error)) throw new SlaError('not_ready', 'not_ready');
    throw new SlaError(error.message, slaErrorCode(error.message));
  }
  return data as T;
}

export interface PublicSettings extends SlaSettings {
  templates: Array<{ id: string; key: string; name: string; description: string }>;
  holiday_lists: string[];
  disclaimer_version: string;
  ready: boolean;
}

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const { data, error } = await safeRpc<Record<string, unknown>>('sla_public_settings');
  if (error || !data) return { ...normalizeSettings({}), templates: [], holiday_lists: [], disclaimer_version: 'draft-1', ready: false };
  return {
    ...normalizeSettings(data),
    templates: Array.isArray(data.templates) ? (data.templates as PublicSettings['templates']) : [],
    holiday_lists: Array.isArray(data.holiday_lists) ? (data.holiday_lists as string[]) : [],
    disclaimer_version: String(data.disclaimer_version ?? 'draft-1'),
    ready: true,
  };
}

export interface PolicySummary {
  id: string; scope: 'platform' | 'template' | 'client'; tenant_id: string | null; template_key: string | null; is_default: boolean;
  name: string; description: string; applies_to: PolicyMeta['applies_to']; status: PolicyStatus; current_version: number;
  active_version: number | null; effective_from: string | null; lock_version: number; updated_at: string; archived_at: string | null;
  can_manage: boolean; owner_name?: string | null;
}
export interface PolicyDetail extends PolicySummary {
  body: PolicyBody; meta: PolicyMeta; problems: PolicyProblem[];
  versions: Array<{ version: number; created_at: string; change_note: string; by_admin: boolean }>;
  company_domain: string | null; member_emails: string[] | null;
}

export const fetchMyPolicies = (tenant: string | null) =>
  call<{ enabled: boolean; can_manage: boolean; policies: PolicySummary[]; platform_default: (PolicySummary & { body: PolicyBody }) | null }>('sla_my_policies', { _tenant: tenant });
export const fetchPolicy = (id: string) => call<PolicyDetail>('sla_policy_get', { _id: id });
export const fetchPolicyVersion = (id: string, version: number) =>
  call<{ version: number; body: PolicyBody; meta: PolicyMeta; change_note: string; created_at: string }>('sla_policy_version', { _id: id, _version: version });
export const savePolicy = (a: { id: string | null; tenant: string | null; meta: PolicyMeta; body: PolicyBody; note: string; lock: number | null }) =>
  call<{ id: string; version: number; problems: PolicyProblem[]; unchanged?: boolean; lock_version: number }>('sla_policy_save', {
    _id: a.id, _tenant: a.tenant, _meta: a.meta, _body: a.body, _note: a.note, _expected_lock: a.lock,
  });
export const activatePolicy = (id: string, version: number, effectiveFrom: string | null, applyToOpen: boolean) =>
  call<{ active_version: number; effective_from: string; tickets_updated: number }>('sla_policy_activate', { _id: id, _version: version, _effective_from: effectiveFrom, _apply_to_open: applyToOpen });
export const archivePolicy = (id: string, reason: string) => call<void>('sla_policy_archive', { _id: id, _reason: reason });
export const duplicatePolicy = (id: string, tenant: string | null, name: string | null) => call<{ id: string; version: number }>('sla_policy_duplicate', { _id: id, _tenant: tenant, _name: name });
export const restorePolicy = (id: string, version: number) => call<{ id: string; version: number }>('sla_policy_restore', { _id: id, _version: version, _note: null });
export const fetchAdminPolicies = (search: string | null, status: string | null) => call<PolicySummary[]>('sla_admin_policies', { _search: search, _status: status, _limit: 200, _offset: 0 });
export const saveAdminSettings = (value: Partial<SlaSettings>, reason: string) => call<Record<string, unknown>>('sla_admin_set_settings', { _value: value, _reason: reason });
export const fetchHolidays = () => call<Array<{ list: string; day: string; label_en: string; label_ar: string }>>('sla_holidays_list');
export const setHoliday = (list: string, day: string, labelEn: string, labelAr: string, remove: boolean) =>
  call<void>('sla_admin_set_holiday', { _list: list, _day: day, _label_en: labelEn, _label_ar: labelAr, _remove: remove });

export interface SlaEvent { kind: string; role: string; data: Record<string, unknown>; at: string }
export interface TicketSla {
  enabled: boolean;
  role: 'admin' | 'client' | 'client_manager' | 'company' | 'consultant' | 'candidate';
  snapshot: null | {
    id: string; policy_name: string; version: number; severity: SeverityKey; reason: string; created_at: string;
    data: { severity: SeverityKey; response_min: number; workaround_min: number | null; resolution_min: number; premium_capped: boolean;
      calendar: ResolvedCalendar; clock: PolicyBody['clock']; escalations: PolicyBody['severities']['S1']['escalations']; breach: PolicyBody['breach']; counter_offer?: boolean };
  };
  legacy?: { response_due: string | null; resolution_due: string | null; first_response_at: string | null; breached: boolean | null };
  clocks: Array<ClockRow & { consumed_now: number }>;
  events: SlaEvent[];
  accepted: boolean | null;
  acceptances: number | null;
  require_acceptance: boolean;
  counters: Array<{ id: string; consultant_id?: string; targets: { response_min: number; resolution_min: number; workaround_min?: number }; note: string; status?: string; created_at: string }> | null;
  reclass: { id: string; from: SeverityKey; to: SeverityKey; reason: string; created_at: string } | null;
  newer_policy: { policy_id: string; version: number; name: string } | null;
  can: Record<'acknowledge' | 'workaround' | 'propose_reclass' | 'accept' | 'counter' | 'decide' | 'reclassify' | 'apply_policy' | 'breach_choice', boolean>;
}

export const fetchTicketSla = (ticketId: string) => call<TicketSla>('sla_ticket_view', { _ticket: ticketId });
export interface ListState { ticket_id: string; severity: SeverityKey; calendar: ResolvedCalendar; clocks: Array<ClockRow & { consumed_now: number }> | null }
export const fetchListStates = (ids: string[]) => call<ListState[]>('sla_list_states', { _tickets: ids.slice(0, 200) });
export const acceptSla = (ticketId: string, context: 'assignment' | 'bid' | 'team') => call<{ accepted: boolean; summary?: string }>('sla_accept', { _ticket: ticketId, _context: context });
export const proposeCounter = (ticketId: string, targets: { response_min: number; resolution_min: number; workaround_min?: number | null }, note: string) =>
  call<string>('sla_counter_propose', { _ticket: ticketId, _targets: targets, _note: note, _proposal: null });
export const decideCounter = (id: string, accept: boolean, note: string) => call<void>('sla_decide_counter', { _id: id, _accept: accept, _note: note });
export const acknowledgeSla = (ticketId: string, note: string, eta: string | null) => call<void>('sla_acknowledge', { _ticket: ticketId, _note: note, _eta: eta });
export const markWorkaround = (ticketId: string, note: string) => call<void>('sla_mark_workaround', { _ticket: ticketId, _note: note });
export const reclassify = (ticketId: string, severity: SeverityKey, reason: string) => call<void>('sla_reclassify', { _ticket: ticketId, _severity: severity, _reason: reason });
export const proposeReclass = (ticketId: string, severity: SeverityKey, reason: string) => call<string>('sla_propose_reclass', { _ticket: ticketId, _severity: severity, _reason: reason });
export const decideReclass = (id: string, accept: boolean) => call<void>('sla_decide_reclass', { _id: id, _accept: accept });
export const applyNewPolicy = (ticketId: string, note: string) => call<{ changed: boolean }>('sla_apply_new_policy', { _ticket: ticketId, _note: note });
export const breachChoice = (ticketId: string, clock: string, choice: 'extend' | 'reassign' | 'admin_help', extendMin: number | null, note: string) =>
  call<void>('sla_breach_choice', { _ticket: ticketId, _clock: clock, _choice: choice, _extend_min: extendMin, _note: note });

export interface ReportRow { ticket_id: string; title: string; severity: SeverityKey; kind: string; target: number; used: number; met_at: string | null; breached_at: string | null; due_at: string | null; paused: boolean; company?: string; consultant?: string; reason?: string | null; acknowledged?: boolean; had_pauses?: boolean }
export interface SlaReport {
  enabled: boolean; days: number; pct: number | null; breached_open: number;
  by_severity: Record<string, { measured: number; met: number; pct: number | null; avg_response_min: number | null; avg_resolution_min: number | null }>;
  at_risk: ReportRow[];
  by_company?: Array<{ name: string | null; measured: number; pct: number | null }>;
  by_consultant?: Array<{ name: string | null; measured: number; pct: number | null }>;
  breaches?: ReportRow[];
  alert_pct?: number;
}
export const fetchClientReport = (tenant: string | null, days: number) => call<SlaReport>('sla_client_report', { _tenant: tenant, _days: days });
export const fetchConsultantReport = (days: number) => call<SlaReport>('sla_consultant_report', { _days: days });
export const fetchAdminReport = (days: number) => call<SlaReport>('sla_admin_report', { _days: days });
export const simulate = (ticketId: string, policyId: string | null, version: number | null) =>
  call<{ severity: SeverityKey; data: TicketSla['snapshot'] extends infer S ? (S extends { data: infer D } ? D : never) : never; plan: Array<{ step: Record<string, unknown>; at: string | null; recipients: number }>; response_due: string | null; resolution_due: string | null } | null>(
    'sla_admin_simulate', { _ticket: ticketId, _policy: policyId, _version: version });

/** Administrator "send a test SLA e-mail to me" (sample data, own address only). */
export async function sendSlaTestEmail(kind: string, lang: 'en' | 'ar') {
  const { data, error } = await supabase.functions.invoke('sla-run', { body: { action: 'test', kind, lang } });
  if (error) throw new SlaError(error.message, 'generic');
  return data as { ok: boolean; reason?: string };
}

// Database calls of the ticket tracking feature (docs/sql/ticket-tracking.sql). Every call goes through safeRpc;
// `notReady` = the prepared SQL is not applied yet, so screens simply show nothing.
import { safeRpc, isMissingRpc, type RpcError } from '@/lib/safeRpc';
import type { TicketFacts, ViewerRole, Responsible, SetterRole } from '@/lib/ticketTracking';

export type TtResult<T> = { data: T | null; error: RpcError | null; notReady: boolean };

const wrap = async <T,>(fn: string, args?: Record<string, unknown>): Promise<TtResult<T>> => {
  const r = await safeRpc<T>(fn, args);
  return { ...r, notReady: isMissingRpc(r.error) };
};

export interface TrackingEvent {
  at: string;
  from: string | null;
  to: string;
  by: SetterRole;
  note: string | null;
  expected_date: string | null;
  responsible: Responsible | null;
  backfill: boolean;
}

export interface TrackingState {
  enabled: boolean;
  role: ViewerRole | null;
  settings?: unknown;
  facts?: TicketFacts;
  allowed?: string[];
  events?: TrackingEvent[];
}

export interface TimelineRow {
  event_at: string;
  source: 'system' | 'manual' | 'comment';
  kind: string;
  actor_role: string | null;
  params: Record<string, unknown>;
}

export const getTracking = (ticketId: string) => wrap<TrackingState>('tt_ticket_tracking', { _ticket: ticketId });
export const getTimeline = (ticketId: string) => wrap<TimelineRow[]>('tt_timeline', { _ticket: ticketId });
export const getListFacts = (ids: string[]) =>
  wrap<Array<{ ticket_id: string; role: ViewerRole; facts: TicketFacts }>>('tt_list_facts', { _tickets: ids.slice(0, 200) });
export const getTrackingSettings = () => wrap<unknown>('tt_settings');
export const setWorkingStatus = (a: { ticketId: string; status: string; note: string; expectedDate: string | null; responsible: string | null; version: number | null }) =>
  wrap<{ version: number; changed: boolean }>('tt_set_working_status', {
    _ticket: a.ticketId, _status: a.status, _note: a.note || null, _expected_date: a.expectedDate || null,
    _responsible: a.responsible || null, _expected_version: a.version,
  });
export const adminTrackingOverview = (days?: number) => wrap<{ settings: unknown; days: number; counts: Record<string, number>; stuck: Array<{ ticket_id: string; title: string; status: string; status_key: string; set_by_role: string; days: number; expected_date: string | null }>; changes_7d: number }>('tt_admin_overview', days ? { _days: days } : {});
export const adminSetTrackingSettings = (value: Record<string, unknown>, reason: string) =>
  wrap<unknown>('tt_admin_set_settings', { _value: value, _reason: reason || null });

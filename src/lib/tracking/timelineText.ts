// Turns one tt_timeline row into display text (title + optional detail) through i18n keys. Pure (the translate
// function is passed in), shared by the timeline list and the PDF/CSV export so both read the same.
import type { TimelineRow } from './api';
import { statusLabel, type TrackingSettings } from '@/lib/ticketTracking';

export type Translate = (key: string, opts?: Record<string, unknown>) => string;

const TICKET_STATUSES = ['new', 'under_review', 'matched', 'in_progress', 'waiting_for_client', 'resolved', 'closed'];
const TEAM_STEPS = ['selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed', 'ready', 'active', 'declined', 'ended', 'removed', 'withdrawn', 'expired', 'replaced'];

export const SIMPLE_KINDS = [
  'created', 'consultant_assigned', 'consultant_removed', 'sla_breached', 'plan_submitted', 'plan_approved', 'plan_rejected',
  'critical_reply', 'match_sent', 'bid_received', 'rate_proposed', 'nda_consultant_signed', 'nda_client_signed',
  'engagement_confirmed', 'invoice_sent', 'meeting_completed', 'timesheet_comment',
] as const;

export function ticketStatusText(t: Translate, s: unknown): string {
  const v = String(s ?? '');
  return TICKET_STATUSES.includes(v) ? t(`tracking.ticketStatus.${v}`) : v.replace(/_/g, ' ');
}

export function actorText(t: Translate, role: string | null | undefined): string {
  const r = ['client', 'consultant', 'admin', 'both', 'system'].includes(String(role)) ? String(role) : 'system';
  return t(`tracking.actor.${r}`);
}

export function eventText(row: TimelineRow, t: Translate, lang: string, settings: TrackingSettings): { title: string; detail: string | null } {
  const p = row.params ?? {};
  switch (row.kind) {
    case 'status':
      return { title: t('tracking.ev.status', { to: ticketStatusText(t, p.to) }), detail: p.from ? t('tracking.ev.before', { from: ticketStatusText(t, p.from) }) : null };
    case 'outcome':
      return { title: t(`tracking.ev.outcome_${p.outcome === 'unresolved' ? 'unresolved' : p.outcome === 'cancelled' ? 'cancelled' : 'cleared'}`), detail: null };
    case 'match_answered':
      return { title: t(String(p.status) === 'accepted' ? 'tracking.ev.match_accepted' : 'tracking.ev.match_answered'), detail: null };
    case 'team_step': {
      const to = String(p.to ?? '');
      return { title: TEAM_STEPS.includes(to) ? t(`tracking.team.${to}`) : t('tracking.ev.team_other', { status: to.replace(/_/g, ' ') }), detail: null };
    }
    case 'rate_decided':
      return { title: t(String(p.status) === 'approved' ? 'tracking.ev.rate_approved' : 'tracking.ev.rate_not_approved'), detail: null };
    case 'brd_attached':
      return { title: p.version ? t('tracking.ev.brd_attached_v', { v: p.version }) : t('tracking.ev.brd_attached'), detail: null };
    case 'document_added':
      return { title: t('tracking.ev.document_added'), detail: typeof p.name === 'string' ? p.name : null };
    case 'timesheet_submitted':
    case 'timesheet_approved':
      return { title: t(`tracking.ev.${row.kind}`), detail: p.hours != null ? t('tracking.ev.hours', { n: Number(p.hours) }) : null };
    case 'invoice_decided':
      return { title: t(String(p.status) === 'approved' ? 'tracking.ev.invoice_approved' : 'tracking.ev.invoice_decided'), detail: null };
    case 'meeting_scheduled':
      return { title: t('tracking.ev.meeting_scheduled'), detail: null };
    case 'messages':
      return { title: t('tracking.ev.messages', { count: Number(p.count) || 0, who: actorText(t, row.actor_role) }), detail: null };
    case 'working_status': {
      const to = statusLabel(settings, String(p.to ?? ''), lang);
      const parts: string[] = [];
      if (p.note) parts.push(String(p.note));
      if (p.expected_date) parts.push(t('tracking.ev.expected', { date: String(p.expected_date) }));
      if (p.responsible) parts.push(t('tracking.ev.responsible', { who: t(`tracking.resp.${String(p.responsible)}`) }));
      return {
        title: p.backfill ? t('tracking.ev.ws_backfill', { to }) : p.from ? t('tracking.ev.ws_change', { from: statusLabel(settings, String(p.from), lang), to }) : t('tracking.ev.ws_set', { to }),
        detail: parts.length ? parts.join(' · ') : null,
      };
    }
    default:
      if ((SIMPLE_KINDS as readonly string[]).includes(row.kind)) return { title: t(`tracking.ev.${row.kind}`), detail: null };
      return { title: row.kind.replace(/_/g, ' '), detail: null };
  }
}

export type TimelineFilter = 'all' | 'system' | 'manual' | 'comment';

export function filterTimeline(rows: readonly TimelineRow[], f: TimelineFilter): TimelineRow[] {
  return f === 'all' ? [...rows] : rows.filter((r) => r.source === f);
}

/**
 * Feature I: consultant-initiated team requests and team-thread access.
 * Mirrors the server rules in docs/sql/team-engagement.sql (sections 15-16) so the ticket page can
 * explain why the "Request an additional consultant" button is unavailable before calling the server.
 * The server functions remain the source of truth.
 */

export const TEAM_REQUEST_DEFAULTS = {
  maxTeamSize: 5,
  maxPendingPerTicket: 3,
  cooldownHours: 24,
  redeclineDays: 7,
  reasonMin: 3,
  reasonMax: 300,
  maxEstimatedHours: 1000,
} as const;

export type TeamRequestSettings = typeof TEAM_REQUEST_DEFAULTS;

/** Member statuses that may ask for an additional consultant (accepted onwards). */
export const REQUEST_ALLOWED_STATUSES = ['accepted', 'rate_approved', 'nda_signed', 'ready', 'active'] as const;
/** Member statuses that count towards the team size. */
export const LIVE_STATUSES = ['selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed', 'ready', 'active'] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface TeamRequestState {
  requesterConsultantId: string;
  requesterStatus: string | null;
  ticketStatus: string;
  reason: string;
  suggestedConsultantId?: string | null;
  estimatedHours?: number | null;
  /** consultant ids of live team members */
  liveMemberIds: string[];
  /** requests on this ticket */
  ticketRequests: Array<{ requesterConsultantId: string; status: string; suggestedConsultantId?: string | null; chosenConsultantId?: string | null; decidedAt?: number | null }>;
  /** creation time (ms) of the requester's latest request on any ticket */
  lastRequestAt?: number | null;
  /** whether the suggested consultant is verified */
  suggestedVerified?: boolean;
}

export type TeamRequestBlocker =
  | 'not_on_team' | 'ticket_finished' | 'reason_length' | 'hours_range' | 'self' | 'not_verified'
  | 'already_on_team' | 'already_suggested' | 'declined_recently' | 'team_full' | 'too_many_pending' | 'cooldown';

export function teamRequestBlocker(s: TeamRequestState, now: number, cfg: TeamRequestSettings = TEAM_REQUEST_DEFAULTS): TeamRequestBlocker | null {
  if (!s.requesterStatus || !(REQUEST_ALLOWED_STATUSES as readonly string[]).includes(s.requesterStatus)) return 'not_on_team';
  if (s.ticketStatus === 'resolved' || s.ticketStatus === 'closed') return 'ticket_finished';
  const reason = s.reason.trim();
  if (reason.length < cfg.reasonMin || reason.length > cfg.reasonMax) return 'reason_length';
  if (s.estimatedHours != null && (s.estimatedHours <= 0 || s.estimatedHours > cfg.maxEstimatedHours)) return 'hours_range';
  const sug = s.suggestedConsultantId ?? null;
  if (sug) {
    if (sug === s.requesterConsultantId) return 'self';
    if (s.suggestedVerified === false) return 'not_verified';
    if (s.liveMemberIds.includes(sug)) return 'already_on_team';
    if (s.ticketRequests.some(r => r.status === 'pending' && (r.suggestedConsultantId === sug || r.chosenConsultantId === sug))) return 'already_suggested';
    if (s.ticketRequests.some(r => r.status === 'declined' && r.suggestedConsultantId === sug && r.decidedAt != null && now - r.decidedAt < cfg.redeclineDays * DAY)) return 'declined_recently';
  }
  if (s.liveMemberIds.length >= cfg.maxTeamSize) return 'team_full';
  if (s.ticketRequests.filter(r => r.requesterConsultantId === s.requesterConsultantId && r.status === 'pending').length >= cfg.maxPendingPerTicket) return 'too_many_pending';
  if (cfg.cooldownHours > 0 && s.lastRequestAt != null && now - s.lastRequestAt < cfg.cooldownHours * HOUR) return 'cooldown';
  return null;
}

export type TeamRequestDecision =
  | { kind: 'approve' }
  | { kind: 'choose'; consultantId: string }
  | { kind: 'decline'; note?: string };

export type TeamRequestOutcome =
  | { status: 'approved'; invite: { consultantId: string; mode: 'normal'; role: 'support'; primary: false }; chosenOther: boolean; audit: 'team_request.approved' }
  | { status: 'declined'; audit: 'team_request.declined' }
  | { error: 'already_answered' | 'no_consultant' | 'already_on_team' };

/** What a decision does: approval only INVITES (normal request, support role); the four gates follow. */
export function decideTeamRequest(
  request: { status: string; requesterConsultantId: string; suggestedConsultantId?: string | null },
  decision: TeamRequestDecision,
): TeamRequestOutcome {
  if (request.status !== 'pending') return { error: 'already_answered' };
  if (decision.kind === 'decline') return { status: 'declined', audit: 'team_request.declined' };
  const target = decision.kind === 'choose' ? decision.consultantId : request.suggestedConsultantId ?? null;
  if (!target) return { error: 'no_consultant' };
  if (target === request.requesterConsultantId) return { error: 'already_on_team' };
  return {
    status: 'approved',
    invite: { consultantId: target, mode: 'normal', role: 'support', primary: false },
    chosenOther: target !== (request.suggestedConsultantId ?? null),
    audit: 'team_request.approved',
  };
}

/** Who may read and write the shared team thread. */
export function teamThreadRole(viewer: { isTicketClient: boolean; isCompanyMember: boolean; isAdmin: boolean; memberStatus?: string | null }): 'client' | 'consultant' | 'admin' | null {
  if (viewer.isTicketClient || viewer.isCompanyMember) return 'client';
  if (viewer.memberStatus === 'ready' || viewer.memberStatus === 'active') return 'consultant';
  if (viewer.isAdmin) return 'admin';
  return null;
}

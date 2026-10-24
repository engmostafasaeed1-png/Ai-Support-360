// Who may see a ticket's BRD. Mirror of public.brd_role_for (docs/sql/ticket-brd.sql) for display and tests; the
// database decides, this only explains.
//
// The reader rule is the existing ticket-document rule (admin, the ticket's client, the client's company members, the
// ticket's consultant, and on gated tickets team members in status ready/active) PLUS, for consultants, an active
// NDA signed by both the consultant and the client while the "require NDA" setting is on (default). Bidders,
// matched-but-not-assigned consultants and plain support assignments are not readers (the ticket-document rule does
// not include them either). Consultants and company members only see versions that are attached to the ticket.

export type BrdRole = 'admin' | 'client' | 'company' | 'consultant';

export interface BrdAccessInput {
  isAdmin: boolean;
  isTicketClient: boolean;
  isCompanyMember: boolean;
  /** tickets.consultant_id belongs to this user. */
  isTicketConsultant: boolean;
  /** Team engagement applies to this ticket (team_ticket_gated). */
  teamGated: boolean;
  /** This user's team-member status on the ticket, if any. */
  teamStatus: string | null;
  /** Active NDA between this consultant and the ticket's client, signed by both. */
  ndaBothSigned: boolean;
  requireNda: boolean;
}

export const TEAM_READER_STATUSES = ['ready', 'active'] as const;

export function brdRole(i: BrdAccessInput): BrdRole | null {
  if (i.isAdmin) return 'admin';
  if (i.isTicketClient) return 'client';
  if (i.isCompanyMember) return 'company';
  const consultantLink = i.isTicketConsultant || (i.teamGated && (TEAM_READER_STATUSES as readonly string[]).includes(i.teamStatus ?? ''));
  if (consultantLink && (!i.requireNda || i.ndaBothSigned)) return 'consultant';
  return null;
}

/** Only the ticket's client and admins write; after the ticket is closed only while an admin has reopened editing. */
export function canWriteBrd(role: BrdRole | null, ticketStatus: string | null | undefined, unlocked: boolean): boolean {
  if (role !== 'admin' && role !== 'client') return false;
  return ticketStatus !== 'closed' || unlocked;
}

/** Consultants and company members see attached (not unattached) versions only. */
export function canSeeVersion(role: BrdRole | null, attached: boolean): boolean {
  if (role === 'admin' || role === 'client') return true;
  if (role === 'consultant' || role === 'company') return attached;
  return false;
}

/** Comments: every reader may comment; consultants only on attached versions. */
export function canComment(role: BrdRole | null, attached: boolean): boolean {
  return role !== null && canSeeVersion(role, attached);
}

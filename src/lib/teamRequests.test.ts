import { describe, expect, it } from 'vitest';
import { decideTeamRequest, teamRequestBlocker, teamThreadRole, type TeamRequestState } from './teamRequests';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const base: TeamRequestState = {
  requesterConsultantId: 'A',
  requesterStatus: 'active',
  ticketStatus: 'in_progress',
  reason: 'Need an MM expert for goods receipt',
  suggestedConsultantId: 'B',
  suggestedVerified: true,
  liveMemberIds: ['A'],
  ticketRequests: [],
  lastRequestAt: null,
};

describe('team request limits', () => {
  it('allows an accepted or active consultant with a reason', () => {
    expect(teamRequestBlocker(base, NOW)).toBeNull();
    expect(teamRequestBlocker({ ...base, requesterStatus: 'accepted' }, NOW)).toBeNull();
  });

  it('blocks consultants who have not accepted, and finished tickets', () => {
    expect(teamRequestBlocker({ ...base, requesterStatus: 'invited' }, NOW)).toBe('not_on_team');
    expect(teamRequestBlocker({ ...base, requesterStatus: null }, NOW)).toBe('not_on_team');
    expect(teamRequestBlocker({ ...base, ticketStatus: 'closed' }, NOW)).toBe('ticket_finished');
  });

  it('requires a short reason (3 to 300 characters)', () => {
    expect(teamRequestBlocker({ ...base, reason: '  ' }, NOW)).toBe('reason_length');
    expect(teamRequestBlocker({ ...base, reason: 'x'.repeat(301) }, NOW)).toBe('reason_length');
  });

  it('cannot suggest yourself or someone already on the team', () => {
    expect(teamRequestBlocker({ ...base, suggestedConsultantId: 'A' }, NOW)).toBe('self');
    expect(teamRequestBlocker({ ...base, liveMemberIds: ['A', 'B'] }, NOW)).toBe('already_on_team');
  });

  it('caps the team at 5 members by default', () => {
    expect(teamRequestBlocker({ ...base, suggestedConsultantId: null, liveMemberIds: ['A', 'C', 'D', 'E'] }, NOW)).toBeNull();
    expect(teamRequestBlocker({ ...base, suggestedConsultantId: null, liveMemberIds: ['A', 'C', 'D', 'E', 'F'] }, NOW)).toBe('team_full');
  });

  it('allows at most 3 open requests per consultant per ticket', () => {
    const pending = (n: number) => Array.from({ length: n }, () => ({ requesterConsultantId: 'A', status: 'pending' }));
    expect(teamRequestBlocker({ ...base, suggestedConsultantId: null, ticketRequests: pending(2) }, NOW)).toBeNull();
    expect(teamRequestBlocker({ ...base, suggestedConsultantId: null, ticketRequests: pending(3) }, NOW)).toBe('too_many_pending');
  });

  it('allows one request per 24 hours per consultant', () => {
    expect(teamRequestBlocker({ ...base, lastRequestAt: NOW - 23 * HOUR }, NOW)).toBe('cooldown');
    expect(teamRequestBlocker({ ...base, lastRequestAt: NOW - 25 * HOUR }, NOW)).toBeNull();
  });

  it('blocks the same person for 7 days after a decline', () => {
    const declined = (daysAgo: number) => [{ requesterConsultantId: 'A', status: 'declined', suggestedConsultantId: 'B', decidedAt: NOW - daysAgo * 24 * HOUR }];
    expect(teamRequestBlocker({ ...base, ticketRequests: declined(6) }, NOW)).toBe('declined_recently');
    expect(teamRequestBlocker({ ...base, ticketRequests: declined(8) }, NOW)).toBeNull();
    expect(teamRequestBlocker({ ...base, suggestedConsultantId: 'C', ticketRequests: declined(1) }, NOW)).toBeNull();
  });
});

describe('team request decisions', () => {
  const req = { status: 'pending', requesterConsultantId: 'A', suggestedConsultantId: 'B' };

  it('approval invites the suggested consultant as a normal request, audited', () => {
    expect(decideTeamRequest(req, { kind: 'approve' })).toEqual({
      status: 'approved', invite: { consultantId: 'B', mode: 'normal', role: 'support', primary: false }, chosenOther: false, audit: 'team_request.approved',
    });
  });

  it('"choose someone else" invites the chosen consultant instead', () => {
    const out = decideTeamRequest(req, { kind: 'choose', consultantId: 'C' });
    expect(out).toMatchObject({ status: 'approved', invite: { consultantId: 'C' }, chosenOther: true });
  });

  it('decline adds nobody and is audited; answered requests cannot be answered again', () => {
    expect(decideTeamRequest(req, { kind: 'decline' })).toEqual({ status: 'declined', audit: 'team_request.declined' });
    expect(decideTeamRequest({ ...req, status: 'declined' }, { kind: 'approve' })).toEqual({ error: 'already_answered' });
  });

  it('approval without a suggested or chosen consultant is refused', () => {
    expect(decideTeamRequest({ ...req, suggestedConsultantId: null }, { kind: 'approve' })).toEqual({ error: 'no_consultant' });
  });
});

describe('team thread access', () => {
  it('client, company colleagues, ready members and admins only', () => {
    expect(teamThreadRole({ isTicketClient: true, isCompanyMember: false, isAdmin: false })).toBe('client');
    expect(teamThreadRole({ isTicketClient: false, isCompanyMember: true, isAdmin: false })).toBe('client');
    expect(teamThreadRole({ isTicketClient: false, isCompanyMember: false, isAdmin: false, memberStatus: 'active' })).toBe('consultant');
    expect(teamThreadRole({ isTicketClient: false, isCompanyMember: false, isAdmin: false, memberStatus: 'nda_signed' })).toBeNull();
    expect(teamThreadRole({ isTicketClient: false, isCompanyMember: false, isAdmin: true })).toBe('admin');
  });
});

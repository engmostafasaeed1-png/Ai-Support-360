import { describe, expect, it } from 'vitest';
import { externalInvitesAllowed, findConflicts, formProblems, scheduleBlock, scheduleBlockText } from './meetingSchedule';

describe('who can schedule a meeting', () => {
  it('a client owner without any assigned consultant is blocked with a reason', () => {
    const b = scheduleBlock({ role: 'client', hasConsultant: false, activeAssignments: 0, isOwner: true, status: 'new' });
    expect(b).toBe('no_consultant');
    expect(scheduleBlockText(b!, 'en')).toContain('once a consultant is assigned');
  });
  it('a team ticket (active assignments, no ticket consultant) can schedule', () => {
    expect(scheduleBlock({ role: 'client', hasConsultant: false, activeAssignments: 2, isOwner: true, status: 'new' })).toBeNull();
  });
  it('a colleague of the same company is not the owner', () => {
    expect(scheduleBlock({ role: 'client', hasConsultant: true, activeAssignments: 0, isOwner: false })).toBe('not_owner');
  });
  it('an unassigned consultant is blocked, an assigned one is not', () => {
    expect(scheduleBlock({ role: 'consultant', hasConsultant: true, activeAssignments: 1, isAssigned: false })).toBe('not_assigned');
    expect(scheduleBlock({ role: 'consultant', hasConsultant: true, activeAssignments: 1, isAssigned: true })).toBeNull();
  });
  it('a closed request gets no new meetings', () => {
    expect(scheduleBlock({ role: 'admin', hasConsultant: true, activeAssignments: 1, status: 'closed' })).toBe('closed');
  });
});

describe('conflict check', () => {
  const busy = [{ consultant_id: 'k1', start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z', kind: 'session' as const }];
  it('an overlapping time of a chosen consultant is a conflict', () => {
    expect(findConflicts(busy, ['k1'], new Date('2026-11-02T10:30:00Z'), 60)).toHaveLength(1);
  });
  it('back-to-back meetings do not conflict', () => {
    expect(findConflicts(busy, ['k1'], new Date('2026-11-02T11:00:00Z'), 30)).toHaveLength(0);
    expect(findConflicts(busy, ['k1'], new Date('2026-11-02T09:00:00Z'), 60)).toHaveLength(0);
  });
  it('another consultant being busy is not a conflict', () => {
    expect(findConflicts(busy, ['k2'], new Date('2026-11-02T10:30:00Z'), 60)).toHaveLength(0);
  });
});

describe('dialog checks', () => {
  const now = new Date('2026-11-01T08:00:00Z');
  it('lists every missing item', () => {
    expect(formProblems({ date: null, participants: 0, now })).toEqual(['date', 'participants']);
  });
  it('a past time, a disabled external switch and a conflict all block', () => {
    const d = new Date('2026-10-31T10:00:00Z');
    expect(formProblems({ date: d, startsAt: d, participants: 1, externalCount: 1, externalAllowed: false, conflicts: 1, now }))
      .toEqual(['past', 'external_disabled', 'conflict']);
  });
  it('a complete form has no problems', () => {
    const d = new Date('2026-11-02T10:00:00Z');
    expect(formProblems({ date: d, startsAt: d, participants: 1, needsLink: true, linkOk: true, now })).toEqual([]);
  });
});

describe('external invitation switch', () => {
  it('is on while never saved and off only when saved off', () => {
    expect(externalInvitesAllowed(undefined)).toBe(true);
    expect(externalInvitesAllowed(true)).toBe(true);
    expect(externalInvitesAllowed(false)).toBe(false);
    expect(externalInvitesAllowed('false')).toBe(false);
  });
});

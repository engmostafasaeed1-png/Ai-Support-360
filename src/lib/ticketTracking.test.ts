import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, EMPTY_FILTER, addSaved, allowedStatuses, applyListFilter, coalesceNotice, countNeedsMe, courtOf,
  deriveStage, durations, needsMyAction, normalizeSettings, parseSaved, reminderDue, reminderRecipients, settingsProblems,
  shouldEmail, validateChange, type ChangeInput, type TicketFacts, type TrackingSummary,
} from './ticketTracking';
import { eventText } from './tracking/timelineText';
import { timelineCsv } from './tracking/timelineExport';

const S = { ...DEFAULT_SETTINGS, enabled: true };
const T0 = '2026-11-01T08:00:00.000Z';

const facts = (p: Partial<TicketFacts> = {}): TicketFacts => ({
  created_at: T0, status: 'new', close_outcome: null, details_ok: false, details_at: null, brd_at: null, bids_at: null, bids_open: false,
  selected_at: null, has_consultant: false, rate_at: null, rate_proposed: false, nda_at: null, nda_state: 'none', gated: false,
  confirmed_at: null, work_at: null, delivered_at: null, closed_at: null, reopened_at: null, team_next: null, working: null, ...p,
});

const change = (p: Partial<ChangeInput>): ChangeInput => ({
  role: 'consultant', ticketStatus: 'in_progress', current: null, key: 'in_analysis', note: '', expectedDate: null, responsible: null, today: '2026-11-10', ...p,
});

describe('automatic stage', () => {
  it('a brand new ticket is at "details complete" and waits for the client', () => {
    const d = deriveStage(facts());
    expect(d.steps[0]).toMatchObject({ key: 'submitted', state: 'done', at: T0 });
    expect(d.current).toBe('details');
    expect(d.next).toEqual({ actor: 'client', key: 'complete_details' });
  });

  it('a legacy ticket (no team engagement) skips the engagement confirmation step', () => {
    const d = deriveStage(facts({ details_ok: true, selected_at: T0, has_consultant: true, rate_at: T0, nda_at: T0, nda_state: 'signed' }));
    expect(d.steps.find((s) => s.key === 'confirmed')!.state).toBe('skipped');
    expect(d.current).toBe('work');
    expect(d.next).toEqual({ actor: 'consultant', key: 'start_work' });
  });

  it('a direct assignment without bids marks "matching" as skipped, not done', () => {
    const d = deriveStage(facts({ details_ok: true, selected_at: T0, has_consultant: true }));
    expect(d.steps.find((s) => s.key === 'matching')!.state).toBe('skipped');
    expect(d.current).toBe('rate');
  });

  it('rate step: waits for the consultant to propose, then for the client to approve', () => {
    const base = { details_ok: true, selected_at: T0, has_consultant: true };
    expect(deriveStage(facts(base)).next).toEqual({ actor: 'consultant', key: 'propose_rate' });
    expect(deriveStage(facts({ ...base, rate_proposed: true })).next).toEqual({ actor: 'client', key: 'approve_rate' });
  });

  it('NDA step: the client signs after the consultant signed', () => {
    const d = deriveStage(facts({ details_ok: true, selected_at: T0, has_consultant: true, rate_at: T0, nda_state: 'consultant_signed' }));
    expect(d.current).toBe('nda');
    expect(d.next).toEqual({ actor: 'client', key: 'client_sign_nda' });
  });

  it('gated tickets follow team_next_step exactly (no duplicate gate rules)', () => {
    const d = deriveStage(facts({ details_ok: true, gated: true, selected_at: T0, has_consultant: true, team_next: { actor: 'consultant', step: 'sign_nda' } }));
    expect(d.next).toEqual({ actor: 'consultant', key: 'team_sign_nda' });
    expect(d.steps.find((s) => s.key === 'confirmed')!.state).toBe('pending');
  });

  it('resolved = delivered done, current step is "closed", the client confirms', () => {
    const d = deriveStage(facts({ status: 'resolved', details_ok: true, has_consultant: true, selected_at: T0, rate_at: T0, nda_at: T0, work_at: T0, delivered_at: T0 }));
    expect(d.steps.find((s) => s.key === 'delivered')!.state).toBe('done');
    expect(d.current).toBe('closed');
    expect(d.next).toEqual({ actor: 'client', key: 'confirm_resolution' });
  });

  it('closed ticket: everything finished, outcome solved / not solved', () => {
    const closed = facts({ status: 'closed', closed_at: T0, details_ok: true });
    expect(deriveStage(closed).current).toBeNull();
    expect(deriveStage(closed).outcome).toBe('solved');
    expect(deriveStage({ ...closed, close_outcome: 'unresolved' }).outcome).toBe('not_solved');
  });

  it('side states: cancelled, on hold, waiting for client (official status or working status)', () => {
    expect(deriveStage(facts({ close_outcome: 'cancelled' })).next.key).toBe('cancelled');
    const hold = deriveStage(facts({ working: { key: 'on_hold', set_at: T0, set_by_role: 'client', note: 'x', expected_date: null, responsible: null, version: 2 } }));
    expect(hold.side).toContainEqual({ kind: 'on_hold' });
    expect(hold.next.key).toBe('on_hold');
    expect(deriveStage(facts({ status: 'waiting_for_client' })).side).toContainEqual({ kind: 'blocked', by: 'client' });
  });

  it('reopened tickets show the reopened side state', () => {
    const d = deriveStage(facts({ status: 'in_progress', reopened_at: T0, delivered_at: '2026-10-30T00:00:00Z' }));
    expect(d.side.some((s) => s.kind === 'reopened')).toBe(true);
    expect(d.steps.find((s) => s.key === 'delivered')!.state).not.toBe('done');
  });
});

describe('who can set what (default matrix)', () => {
  it('"Waiting for client information" and "Ready for client review" only by the consultant', () => {
    expect(validateChange(change({ role: 'client', key: 'waiting_client_info', note: 'x' }), S)).toBe('not_allowed');
    expect(validateChange(change({ role: 'consultant', key: 'waiting_client_info', note: 'Need the transport list' }), S)).toBeNull();
    expect(validateChange(change({ role: 'client', key: 'ready_for_review' }), S)).toBe('not_allowed');
    expect(validateChange(change({ role: 'consultant', key: 'ready_for_review' }), S)).toBeNull();
  });

  it('"Needs rework" only by the client, with a note', () => {
    expect(validateChange(change({ role: 'consultant', key: 'needs_rework', note: 'x' }), S)).toBe('not_allowed');
    expect(validateChange(change({ role: 'client', key: 'needs_rework' }), S)).toBe('note_required');
    expect(validateChange(change({ role: 'client', key: 'needs_rework', note: 'Posting still fails' }), S)).toBeNull();
  });

  it('"On hold" by either side, the note is mandatory', () => {
    for (const role of ['client', 'consultant'] as const) {
      expect(validateChange(change({ role, key: 'on_hold' }), S)).toBe('note_required');
      expect(validateChange(change({ role, key: 'on_hold', note: 'Year-end freeze' }), S)).toBeNull();
    }
  });

  it('observers and bidders cannot set anything; admins can set every status', () => {
    expect(allowedStatuses('observer', S)).toEqual([]);
    expect(allowedStatuses(null, S)).toEqual([]);
    expect(allowedStatuses('admin', S)).toHaveLength(S.statuses.length);
    expect(validateChange(change({ role: 'observer', key: 'in_testing' }), S)).toBe('not_allowed');
  });

  it('notes may not carry contact details (M60 filter)', () => {
    expect(validateChange(change({ key: 'in_analysis', note: 'mail me at a@b.com' }), S)).toBe('contact_details');
    expect(validateChange(change({ key: 'in_analysis', note: 'call +20 100 123 4567' }), S)).toBe('contact_details');
  });

  it('expected date between today and one year; closed tickets cannot change (except admin)', () => {
    expect(validateChange(change({ expectedDate: '2026-11-09' }), S)).toBe('date_past');
    expect(validateChange(change({ expectedDate: '2027-11-11' }), S)).toBe('date_far');
    expect(validateChange(change({ expectedDate: '2026-11-10' }), S)).toBeNull();
    expect(validateChange(change({ ticketStatus: 'closed' }), S)).toBe('closed');
    expect(validateChange(change({ role: 'admin', ticketStatus: 'closed' }), S)).toBeNull();
  });

  it('saving the same status with the same details is not a change', () => {
    const cur = { key: 'in_analysis', note: null, expected_date: null, responsible: null };
    expect(validateChange(change({ current: cur }), S)).toBe('unchanged');
  });

  it('a switched-off status cannot be chosen', () => {
    const off = { ...S, statuses: S.statuses.map((s) => (s.key === 'in_testing' ? { ...s, enabled: false } : s)) };
    expect(validateChange(change({ key: 'in_testing' }), off)).toBe('unknown_status');
  });
});

describe('admin settings', () => {
  it('feature is OFF by default', () => {
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
    expect(normalizeSettings(null).enabled).toBe(false);
  });

  it('built-in statuses cannot be removed and "Not started" stays on', () => {
    expect(settingsProblems(S)).toEqual([]);
    const without = { ...S, statuses: S.statuses.filter((s) => s.key !== 'needs_rework') };
    expect(settingsProblems(without)).toContain('missing:needs_rework');
    const offNs = { ...S, statuses: S.statuses.map((s) => (s.key === 'not_started' ? { ...s, enabled: false } : s)) };
    expect(settingsProblems(offNs)).toContain('not_started_off');
  });
});

describe('waiting on whom and durations', () => {
  it('court: explicit responsible wins; "Completed" passes the ball to the other side', () => {
    expect(courtOf('in_development', 'consultant', null, S)).toBe('consultant');
    expect(courtOf('in_development', 'consultant', 'client', S)).toBe('client');
    expect(courtOf('completed', 'consultant', null, S)).toBe('client');
  });

  it('time per status and per court', () => {
    const d = durations([
      { at: '2026-11-01T00:00:00Z', to: 'in_analysis', by: 'consultant', responsible: null },
      { at: '2026-11-02T00:00:00Z', to: 'waiting_client_info', by: 'consultant', responsible: null },
    ], Date.parse('2026-11-04T00:00:00Z'), S);
    expect(d.byStatus.in_analysis).toBe(86_400_000);
    expect(d.byStatus.waiting_client_info).toBe(2 * 86_400_000);
    expect(d.byCourt.client).toBe(2 * 86_400_000);
    expect(d.byCourt.consultant).toBe(86_400_000);
  });
});

describe('reminders and throttling', () => {
  const row = { key: 'in_development', set_by_role: 'consultant' as const, set_at: '2026-11-01T00:00:00Z', expected_date: '2026-11-11', last_reminder_on: null, overdue_reminders: 0, review_reminded_on: null, review_reminders: 0, ticket_status: 'in_progress' };

  it('one day before, then overdue; at most one per day; stops at the cap', () => {
    expect(reminderDue(row, '2026-11-10', S)).toBe('due_tomorrow');
    expect(reminderDue({ ...row, expected_date: '2026-11-09' }, '2026-11-10', S)).toBe('overdue');
    expect(reminderDue({ ...row, expected_date: '2026-11-09', last_reminder_on: '2026-11-10' }, '2026-11-10', S)).toBeNull();
    expect(reminderDue({ ...row, expected_date: '2026-11-09', overdue_reminders: 3 }, '2026-11-10', S)).toBeNull();
  });

  it('no reminders while off, for closed tickets or backfilled rows', () => {
    expect(reminderDue(row, '2026-11-10', DEFAULT_SETTINGS)).toBeNull();
    expect(reminderDue({ ...row, ticket_status: 'closed' }, '2026-11-10', S)).toBeNull();
    expect(reminderDue({ ...row, set_by_role: 'system' }, '2026-11-10', S)).toBeNull();
  });

  it('"Ready for client review" for more than 3 days reminds the client', () => {
    const r = { ...row, key: 'ready_for_review', expected_date: null, set_at: '2026-11-06T09:00:00Z' };
    expect(reminderDue(r, '2026-11-08', S)).toBeNull();
    expect(reminderDue(r, '2026-11-09', S)).toBe('review');
    expect(reminderRecipients(null, 'ready_for_review', 'consultant', 'review', S)).toEqual(['client']);
  });

  it('expected-date reminders go to the responsible side', () => {
    expect(reminderRecipients('client', 'in_development', 'consultant', 'overdue', S)).toEqual(['client']);
    expect(reminderRecipients('third_party', 'in_development', 'consultant', 'overdue', S)).toEqual(['client', 'consultant']);
  });

  it('rapid changes make one notice (15 minutes by default)', () => {
    const now = Date.parse('2026-11-10T10:10:00Z');
    expect(coalesceNotice({ created_at: '2026-11-10T10:00:00Z', is_read: false }, now, 15)).toBe('update');
    expect(coalesceNotice({ created_at: '2026-11-10T10:00:00Z', is_read: true }, now, 15)).toBe('insert');
    expect(coalesceNotice({ created_at: '2026-11-10T09:40:00Z', is_read: false }, now, 15)).toBe('insert');
    expect(shouldEmail('2026-11-10T10:00:00Z', now, 15)).toBe(false);
    expect(shouldEmail('2026-11-10T09:50:00Z', now, 15)).toBe(true);
  });
});

describe('lists', () => {
  const w = (key: string, by: 'client' | 'consultant') => ({ key, set_at: T0, set_by_role: by, note: null, expected_date: null, responsible: null, version: 2 });
  const work = { details_ok: true, has_consultant: true, selected_at: T0, rate_at: T0, nda_at: T0, nda_state: 'signed' as const, work_at: T0, status: 'in_progress' };
  const map = new Map<string, TrackingSummary>([
    ['a', { ticket_id: 'a', role: 'client', facts: facts({ ...work, working: w('waiting_client_info', 'consultant') }) }],
    ['b', { ticket_id: 'b', role: 'client', facts: facts({ ...work, working: w('in_development', 'consultant') }) }],
  ]);

  it('"Needs my action" uses the working status court', () => {
    expect(needsMyAction(map.get('a')!, S)).toBe(true);
    expect(needsMyAction(map.get('b')!, S)).toBe(false);
    expect(countNeedsMe(map, S)).toBe(1);
  });

  it('filters by working status and sorts "waiting for me" first', () => {
    const items = [{ id: 'b' }, { id: 'a' }];
    expect(applyListFilter(items, map, { ...EMPTY_FILTER, working: 'in_development' }, S).map((x) => x.id)).toEqual(['b']);
    expect(applyListFilter(items, map, { ...EMPTY_FILTER, sort: 'waiting_me' }, S).map((x) => x.id)).toEqual(['a', 'b']);
    expect(applyListFilter(items, map, { ...EMPTY_FILTER, needsMe: true }, S).map((x) => x.id)).toEqual(['a']);
  });

  it('saved filters: newest first, same name replaced, broken storage ignored', () => {
    const one = addSaved([], 'Mine', { ...EMPTY_FILTER, needsMe: true });
    const two = addSaved(one, 'Mine', EMPTY_FILTER);
    expect(two).toHaveLength(1);
    expect(parseSaved('not json')).toEqual([]);
    expect(parseSaved(JSON.stringify(two))[0].name).toBe('Mine');
  });
});

describe('timeline text and export', () => {
  const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k);
  it('working status rows show from → to with the note', () => {
    const r = eventText({ event_at: T0, source: 'manual', kind: 'working_status', actor_role: 'consultant', params: { from: 'in_analysis', to: 'in_testing', note: 'Unit tests done' } }, t, 'en', S);
    expect(r.title).toContain('tracking.ev.ws_change');
    expect(r.title).toContain('In testing');
    expect(r.detail).toBe('Unit tests done');
  });

  it('CSV escapes quotes and keeps one row per event', () => {
    const csv = timelineCsv([{ event_at: T0, source: 'manual', kind: 'working_status', actor_role: 'client', params: { to: 'on_hold', note: 'Say "hold"' } }], t, 'en', S);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Say ""hold"""');
  });
});

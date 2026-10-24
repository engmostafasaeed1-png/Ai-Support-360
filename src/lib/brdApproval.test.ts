import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  approvalErrorKey, currentRound, decisionProblem, gateBlocks, lastApprovedBefore, roundState, sortByApproval,
  type ApprovalListRow, type ApprovalRound, type GateInput,
} from './brdApproval';
import { deriveStage, type TicketFacts } from './ticketTracking';
import { eventText } from './tracking/timelineText';
import { DEFAULT_SETTINGS } from './ticketTracking';
import { brdNoticeTicket, brdNoticeTone, brdNoticeVersion, isBrdApprovalNotice } from './brdApprovalNotice';
import { BRD_APPROVAL_EMAIL_KINDS, renderBrdApprovalEmail, sampleBrdApprovalEmail } from '../../supabase/functions/_shared/brdApprovalEmail';

const gate = (p: Partial<GateInput> = {}): GateInput => ({
  enabled: true, mode: 'required', waived: false, latest: { closed: false, state: 'pending' }, anyApproved: false, allMembers: false, ...p,
});

describe('BRD approval: round state (mirror of brd_round_state)', () => {
  it('waits until every required approver approved', () => {
    expect(roundState({ closedReason: null, decisions: [], required: 1, carried: false, approvedAt: null })).toBe('pending');
    expect(roundState({ closedReason: null, decisions: ['approved'], required: 1, carried: false, approvedAt: null })).toBe('approved');
    expect(roundState({ closedReason: null, decisions: ['approved'], required: 3, carried: false, approvedAt: null })).toBe('pending');
  });
  it('a decline wins over changes, changes over approvals', () => {
    expect(roundState({ closedReason: null, decisions: ['approved', 'changes_requested'], required: 2, carried: false, approvedAt: null })).toBe('changes_requested');
    expect(roundState({ closedReason: null, decisions: ['changes_requested', 'declined'], required: 2, carried: false, approvedAt: null })).toBe('rejected');
  });
  it('a newer submission or a withdrawal closes the round', () => {
    expect(roundState({ closedReason: 'superseded', decisions: ['approved'], required: 1, carried: false, approvedAt: 'x' })).toBe('superseded');
    expect(roundState({ closedReason: 'withdrawn', decisions: [], required: 1, carried: false, approvedAt: null })).toBe('withdrawn');
  });
  it('"no material change" keeps the earlier approval', () => {
    expect(roundState({ closedReason: null, decisions: [], required: 1, carried: true, approvedAt: '2026-11-01' })).toBe('approved');
  });
});

describe('BRD approval: the gate (mirror of brd_gate_state blocks)', () => {
  it('"Recommended" (the default) and "Off" never block', () => {
    expect(gateBlocks(gate({ mode: 'recommended' }))).toBe(false);
    expect(gateBlocks(gate({ mode: 'off' }))).toBe(false);
  });
  it('"Required" blocks only while a submitted BRD waits for approval', () => {
    expect(gateBlocks(gate())).toBe(true);
    expect(gateBlocks(gate({ latest: { closed: false, state: 'changes_requested' } }))).toBe(true);
    expect(gateBlocks(gate({ latest: { closed: false, state: 'approved' } }))).toBe(false);
  });
  it('no BRD submitted, or the request withdrawn ("proceed without BRD"): nothing blocks', () => {
    expect(gateBlocks(gate({ latest: null }))).toBe(false);
    expect(gateBlocks(gate({ latest: { closed: true, state: 'withdrawn' } }))).toBe(false);
  });
  it('an admin waiver or the BRD feature switched off opens the gate', () => {
    expect(gateBlocks(gate({ waived: true }))).toBe(false);
    expect(gateBlocks(gate({ enabled: false }))).toBe(false);
  });
  it('an earlier approved version keeps the work going while a newer one waits', () => {
    expect(gateBlocks(gate({ anyApproved: true }))).toBe(false);
  });
  it('"all members must approve": a required member who never approved is blocked', () => {
    expect(gateBlocks(gate({ anyApproved: true, allMembers: true, consultantRequired: true, consultantApprovedBefore: false }))).toBe(true);
    expect(gateBlocks(gate({ anyApproved: true, allMembers: true, consultantRequired: true, consultantApprovedBefore: true }))).toBe(false);
    expect(gateBlocks(gate({ anyApproved: true, allMembers: true, consultantRequired: false }))).toBe(false);
  });
});

describe('BRD approval: decision input (mirror of brd_decide_approval)', () => {
  it('approve needs the "I have read it" tick, comment optional', () => {
    expect(decisionProblem('approved', '', false)).toBe('confirm_read');
    expect(decisionProblem('approved', '', true)).toBeNull();
  });
  it('request changes and decline need at least 10 characters', () => {
    expect(decisionProblem('changes_requested', 'too short', false)).toBe('note_required');
    expect(decisionProblem('declined', 'Out of my FI expertise', false)).toBeNull();
  });
  it('contact details are refused and notes are capped at 2000 characters', () => {
    expect(decisionProblem('declined', 'Please call me on +20 100 123 4567', false)).toBe('contact_details');
    expect(decisionProblem('declined', 'mail me at someone@example.com please', false)).toBe('contact_details');
    expect(decisionProblem('changes_requested', 'x'.repeat(2001), false)).toBe('note_too_long');
  });
  it('database errors map to readable messages', () => {
    expect(approvalErrorKey('brd_approval_superseded: a newer version (v3) was submitted')).toBe('brd.approval.err.brd_approval_superseded');
    expect(approvalErrorKey('Waiting for BRD approval: the assigned consultant must approve')).toBe('brd.approval.err.gate');
    expect(approvalErrorKey('boom')).toBe('brd.approval.err.generic');
  });
});

const round = (p: Partial<ApprovalRound>): ApprovalRound => ({
  id: 'r', version: 1, state: 'pending', hash: 'a'.repeat(64), version_status: 'final', submitted_at: '2026-11-01T08:00:00Z', submitted_by: 'Client',
  due_at: null, approved_at: null, closed_at: null, closed_reason: null, close_note: null, no_material_change: false, previous_version: null,
  submit_note: null, decisions: [], ...p,
});

describe('BRD approval: rounds and lists', () => {
  it('picks the open round, and the last approved version for "what changed"', () => {
    const rounds = [round({ id: 'c', version: 3 }), round({ id: 'b', version: 2, approved_at: 'x', closed_at: 'y', closed_reason: 'superseded', submitted_at: '2026-11-02T00:00:00Z' }),
      round({ id: 'a', version: 1, closed_at: 'y', closed_reason: 'superseded' })];
    expect(currentRound(rounds)?.version).toBe(3);
    expect(lastApprovedBefore(rounds, 3)?.version).toBe(2);
  });
  it('"Needs my approval" first, then waiting tickets, others keep their order', () => {
    const rows = new Map<string, ApprovalListRow>([
      ['b', { ticket_id: 'b', state: 'pending', version: 1, mode: 'required', blocks: true, needs_me: false, waiting_consultant: true }],
      ['c', { ticket_id: 'c', state: 'pending', version: 1, mode: 'required', blocks: true, needs_me: true, waiting_consultant: true }],
    ]);
    expect(sortByApproval([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], rows).map((x) => x.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});

const T0 = '2026-11-01T08:00:00.000Z';
const facts = (p: Partial<TicketFacts> = {}): TicketFacts => ({
  created_at: T0, status: 'in_progress', close_outcome: null, details_ok: true, details_at: T0, brd_at: null, bids_at: null, bids_open: false,
  selected_at: T0, has_consultant: true, rate_at: T0, rate_proposed: false, nda_at: T0, nda_state: 'signed', gated: false,
  confirmed_at: null, work_at: null, delivered_at: null, closed_at: null, reopened_at: null, team_next: null, working: null, ...p,
});
const fact = (p: Partial<NonNullable<TicketFacts['brd_approval']>>) => ({
  enabled: true, mode: 'required' as const, waived: false, state: 'pending' as const, version: 2, open: true, approved_at: null, blocks: true, ...p,
});

describe('BRD approval in the ticket stage', () => {
  it('without the database update or any BRD round the step is "not used"', () => {
    expect(deriveStage(facts()).steps.find((s) => s.key === 'brd')!.state).toBe('skipped');
    expect(deriveStage(facts({ brd_approval: fact({ state: 'not_requested', open: false, blocks: false }) })).steps.find((s) => s.key === 'brd')!.state).toBe('skipped');
  });
  it('required and waiting: the BRD step is current, the consultant must approve, "Waiting for BRD approval" shows', () => {
    const d = deriveStage(facts({ brd_approval: fact({}) }));
    expect(d.current).toBe('brd');
    expect(d.next).toEqual({ actor: 'consultant', key: 'approve_brd' });
    expect(d.side).toContainEqual({ kind: 'brd_waiting' });
  });
  it('changes requested: the client updates the BRD', () => {
    expect(deriveStage(facts({ brd_approval: fact({ state: 'changes_requested' }) })).next).toEqual({ actor: 'client', key: 'update_brd' });
  });
  it('recommended mode shows the open round as pending without blocking the pipeline', () => {
    const d = deriveStage(facts({ brd_approval: fact({ mode: 'recommended', blocks: false }) }));
    expect(d.steps.find((s) => s.key === 'brd')!.state).toBe('pending');
    expect(d.current).toBe('work');
    expect(d.side.some((s) => s.kind === 'brd_waiting')).toBe(false);
  });
  it('approved: done with the approval time', () => {
    const d = deriveStage(facts({ brd_approval: fact({ state: 'approved', approved_at: '2026-11-03T10:00:00Z', blocks: false }) }));
    expect(d.steps.find((s) => s.key === 'brd')).toMatchObject({ state: 'done', at: '2026-11-03T10:00:00Z' });
  });
  it('timeline rows read with the consultant name and the comment', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}|${JSON.stringify(o ?? {})}`;
    const r = eventText({ event_at: T0, source: 'system', kind: 'brd_changes', actor_role: 'consultant', params: { version: 2, who: 'M. S****', note: 'Add tolerance limits' } } as never, t, 'en', DEFAULT_SETTINGS);
    expect(r.title).toContain('tracking.ev.brd_changes');
    expect(r.title).toContain('M. S****');
    expect(r.detail).toBe('Add tolerance limits');
  });
});

describe('BRD approval notices', () => {
  it('known types, colours and stored-text parsing', () => {
    expect(isBrdApprovalNotice('brd_approval_declined')).toBe(true);
    expect(isBrdApprovalNotice('brd')).toBe(false);
    expect(brdNoticeTone('brd_approval_approved')).toBe('success');
    expect(brdNoticeTone('brd_approval_changes')).toBe('warning');
    expect(brdNoticeTone('brd_approval_declined')).toBe('destructive');
    expect(brdNoticeVersion('Please approve BRD v12')).toBe(12);
    expect(brdNoticeTicket('BRD v2 of "MIRO invoices" is ready')).toBe('MIRO invoices');
  });
});

describe('BRD approval e-mails (shared layout)', () => {
  it('every kind renders in English and Arabic (RTL)', () => {
    for (const k of BRD_APPROVAL_EMAIL_KINDS) {
      const en = renderBrdApprovalEmail(sampleBrdApprovalEmail(k, 'en'));
      const ar = renderBrdApprovalEmail(sampleBrdApprovalEmail(k, 'ar'));
      expect(en.html).toContain('dir="ltr"');
      expect(ar.html).toContain('dir="rtl"');
      expect(en.subject.length).toBeGreaterThan(5);
      expect(en.text).toContain('https://www.aisupport360.com/');
    }
  });
  it('hero colour follows the outcome: green approved, red declined', () => {
    expect(renderBrdApprovalEmail(sampleBrdApprovalEmail('approved', 'en')).html).toContain('#166534');
    expect(renderBrdApprovalEmail(sampleBrdApprovalEmail('declined', 'en')).html).toContain('#991B1B');
  });
  it('escapes text and never links outside our own domain', () => {
    const r = renderBrdApprovalEmail({ kind: 'changes_requested', ticketTitle: '<script>x</script>', note: '"><img src=x onerror=1>', path: 'https://evil.example/x', version: 2 });
    expect(r.html).not.toContain('<script>x');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).not.toContain('evil.example');
  });
  it('the request lists what changed since the approved version and the due date', () => {
    const r = renderBrdApprovalEmail(sampleBrdApprovalEmail('request', 'en'));
    expect(r.text).toContain('What changed since v2');
    expect(r.text).toContain('Functional requirements');
    expect(r.text).toContain('Please decide by');
  });
});

describe('prepared SQL: shared function bodies are identical in every file', () => {
  const read = (f: string) => readFileSync(`docs/sql/${f}`, 'utf8');
  const body = (text: string, name: string) => {
    const i = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (i < 0) return null;
    const lines = text.slice(i).split('\n');
    const out: string[] = [];
    for (const l of lines) { out.push(l); if (/\$\$;\s*$/.test(l)) break; }
    return out.join('\n');
  };
  const approval = read('ticket-brd-approval.sql');
  const homes: Record<string, string[]> = {
    'ticket-brd.sql': ['brd_default_settings', 'admin_brd_set_settings', 'brd_role_for', 'brd_consultant_readers'],
    'team-engagement.sql': ['team_gates', 'team_next_step', 'team_step_text'],
    'ticket-tracking.sql': ['tt_facts', 'tt_timeline'],
  };
  for (const [file, names] of Object.entries(homes)) {
    for (const n of names) {
      it(`${n} in ${file}`, () => {
        const home = body(read(file), n);
        expect(home).not.toBeNull();
        expect(home).toBe(body(approval, n));
      });
    }
  }
  it('home files create the hook stubs only while they are missing', () => {
    expect(read('team-engagement.sql')).toContain("to_regprocedure('public.team_brd_gate(uuid,uuid)') IS NULL");
    expect(read('ticket-tracking.sql')).toContain("to_regprocedure('public.tt_brd_approval_fact(uuid)') IS NULL");
    expect(read('ticket-tracking.sql')).toContain("to_regprocedure('public.tt_brd_approval_events(uuid,uuid)') IS NULL");
  });
  it('approval tables are never readable by browsers', () => {
    expect(approval).toMatch(/REVOKE ALL ON public\.ticket_brd_approval_requests, public\.ticket_brd_approvals[^;]+FROM anon, authenticated;/);
    expect(approval).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON public\.ticket_brd_approval[^;]*TO (anon|authenticated)/);
  });
});

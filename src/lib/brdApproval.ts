// BRD approval by the assigned consultant(s): display helpers and a mirror of the database rules in
// docs/sql/ticket-brd-approval.sql (brd_round_state, brd_gate_state, brd_decide_approval input checks). The
// database decides; this file only explains the state on screen and lets tests pin the rules.

export type ApprovalMode = 'off' | 'recommended' | 'required';
export type RoundState = 'not_requested' | 'pending' | 'approved' | 'changes_requested' | 'rejected' | 'superseded' | 'withdrawn';
export type Decision = 'approved' | 'changes_requested' | 'declined';
export type MemberRole = 'lead' | 'support';

export interface ApprovalDecisionRow {
  who: string; role: MemberRole; decision: Decision; note: string | null; at: string; mine: boolean; hash: string;
}
export interface ApprovalRound {
  id: string; version: number; state: RoundState; hash: string; version_status: 'draft' | 'final';
  submitted_at: string; submitted_by: string; due_at: string | null; approved_at: string | null;
  closed_at: string | null; closed_reason: 'superseded' | 'withdrawn' | null; close_note: string | null;
  no_material_change: boolean; previous_version: number | null; submit_note: string | null;
  decisions: ApprovalDecisionRow[];
}
export interface GateState {
  enabled: boolean; mode: ApprovalMode; waived: boolean; waived_at: string | null; state: RoundState;
  version: number | null; submitted_at: string | null; due_at: string | null; open: boolean;
  approved_at: string | null; approved_version: number | null; covered: boolean; blocks: boolean;
}
export interface RequiredApprover { who: string; role: MemberRole; can_read: boolean; mine: boolean; decision: Decision | null }
export interface ApprovalView {
  role: 'admin' | 'client' | 'company' | 'consultant' | null;
  enabled?: boolean;
  gate?: GateState;
  rounds?: ApprovalRound[];
  required?: RequiredApprover[];
  me?: { is_approver: boolean; can_decide: boolean; decision: Decision | null; can_submit: boolean; can_waive: boolean };
  waiver?: { active: boolean; at?: string; reason?: string | null; by?: string | null };
  settings?: { mode: ApprovalMode; all_members: boolean; allow_no_change: boolean; remind_days: number };
}
export interface ApprovalListRow {
  ticket_id: string; state: RoundState; version: number | null; mode: ApprovalMode; blocks: boolean; needs_me: boolean; waiting_consultant: boolean;
}

export const NOTE_MIN = 10;
export const NOTE_MAX = 2000;

// ------------------------------------------------------------------ mirror of brd_round_state

export interface RoundInput {
  closedReason: 'superseded' | 'withdrawn' | null;
  /** Decisions of the consultants who are required approvers right now. */
  decisions: Decision[];
  required: number;
  carried: boolean;
  approvedAt: string | null;
}

export function roundState(r: RoundInput): RoundState {
  if (r.closedReason) return r.closedReason;
  if (r.decisions.includes('declined')) return 'rejected';
  if (r.decisions.includes('changes_requested')) return 'changes_requested';
  const ok = r.decisions.filter((d) => d === 'approved').length;
  if (r.required > 0 && ok >= r.required) return 'approved';
  if (r.carried && r.approvedAt) return 'approved';
  return 'pending';
}

// ------------------------------------------------------------------ mirror of brd_gate_state ->> 'blocks'

export interface GateInput {
  enabled: boolean;
  mode: ApprovalMode;
  waived: boolean;
  /** The newest round: open (closed = false) or closed (superseded / withdrawn), or none. */
  latest: { closed: boolean; state: RoundState } | null;
  /** Some round of this ticket was fully approved at some time. */
  anyApproved: boolean;
  allMembers: boolean;
  /** Only with allMembers and a consultant: this consultant must approve and has approved an approved round. */
  consultantRequired?: boolean;
  consultantApprovedBefore?: boolean;
}

export function gateBlocks(g: GateInput): boolean {
  if (!g.enabled || g.mode !== 'required' || g.waived) return false;
  if (!g.latest || g.latest.closed) return false; // no BRD submitted, or withdrawn: the BRD is optional
  if (g.latest.state === 'approved') return false;
  if (g.anyApproved) {
    if (!g.allMembers || g.consultantRequired === undefined) return false;
    if (!g.consultantRequired || g.consultantApprovedBefore) return false;
  }
  return true;
}

// ------------------------------------------------------------------ decision input (mirror of brd_decide_approval)

export type DecisionProblem = 'confirm_read' | 'note_required' | 'note_too_long' | 'contact_details' | null;

const CONTACT = /(@[a-z0-9-]+\.[a-z]{2,})|(\+?\d[\d\s().-]{7,}\d)|(wa\.me|t\.me|whatsapp|telegram|skype)/i;

export function decisionProblem(decision: Decision, note: string, confirmRead: boolean): DecisionProblem {
  const n = note.trim();
  if (n.length > NOTE_MAX) return 'note_too_long';
  if (decision !== 'approved' && n.length < NOTE_MIN) return 'note_required';
  if (n && CONTACT.test(n)) return 'contact_details';
  if (decision === 'approved' && !confirmRead) return 'confirm_read';
  return null;
}

// ------------------------------------------------------------------ display

export type ApprovalTone = 'success' | 'warning' | 'destructive' | 'info' | 'muted';

export function stateTone(s: RoundState | null | undefined): ApprovalTone {
  switch (s) {
    case 'approved': return 'success';
    case 'changes_requested': return 'warning';
    case 'rejected': return 'destructive';
    case 'pending': return 'info';
    default: return 'muted';
  }
}

/** The round shown for one version: its newest round (rounds come newest first). */
export function roundForVersion(rounds: readonly ApprovalRound[] | undefined, version: number): ApprovalRound | null {
  return (rounds ?? []).find((r) => r.version === version) ?? null;
}

/** The newest round of the ticket (open first). */
export function currentRound(rounds: readonly ApprovalRound[] | undefined): ApprovalRound | null {
  const list = rounds ?? [];
  return list.find((r) => !r.closed_at) ?? list[0] ?? null;
}

/** The last fully approved round before `version` (for "what changed since the version you approved"). */
export function lastApprovedBefore(rounds: readonly ApprovalRound[] | undefined, version: number): ApprovalRound | null {
  return (rounds ?? []).filter((r) => r.approved_at && r.version !== version).sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))[0] ?? null;
}

export function shortHash(h: string | null | undefined): string {
  return String(h ?? '').slice(0, 12);
}

/** Error codes raised by the database, mapped to i18n keys under brd.approval.err. */
export function approvalErrorKey(message: string | null | undefined): string {
  const m = String(message ?? '');
  const known = ['brd_approval_superseded', 'brd_already_decided', 'brd_confirm_read_required', 'brd_note_required', 'brd_note_too_long',
    'contact_details_not_allowed', 'brd_not_an_approver', 'brd_approval_not_open', 'brd_attach_first', 'brd_approval_off',
    'brd_no_change_not_allowed', 'brd_no_approved_version', 'brd_reason_required', 'rate_limited', 'not_allowed'];
  const hit = known.find((k) => m.includes(k));
  if (hit) return `brd.approval.err.${hit}`;
  if (/Waiting for BRD approval/i.test(m)) return 'brd.approval.err.gate';
  return 'brd.approval.err.generic';
}

/** "Needs my approval" first, then waiting ones; others keep their order. */
export function sortByApproval<T extends { id: string }>(items: readonly T[], rows: ReadonlyMap<string, ApprovalListRow>): T[] {
  const rank = (t: T) => { const r = rows.get(t.id); return r?.needs_me ? 0 : r?.waiting_consultant ? 1 : 2; };
  return [...items].map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}

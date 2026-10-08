export type ClientApprovalStatus =
  | 'draft'
  | 'awaiting_confirmation'
  | 'changes_requested'
  | 'approved'
  | 'rejected';

export type ClientApprovalEventType =
  | 'submitted'
  | 'resubmitted'
  | 'approved'
  | 'auto_approved'
  | 'changes_requested'
  | 'rejected';

export interface ClientApprovalEvent {
  event: ClientApprovalEventType;
  comment: string | null;
  created_at: string;
  actor_name?: string | null;
}

/** What my_client_approval() returns for the signed-in client (null when the user has no client profile). */
export interface ClientApproval {
  status: ClientApprovalStatus;
  /** false when the platform switch client_approval_required is off: nothing is blocked then */
  required: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  comment: string | null;
  /** a company name and at least one SAP module are filled in */
  ready: boolean;
  events: ClientApprovalEvent[];
}

export const APPROVAL_STATUS_LABEL: Record<ClientApprovalStatus, string> = {
  draft: 'Not sent yet',
  awaiting_confirmation: 'Awaiting confirmation',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Not approved',
};

export const APPROVAL_EVENT_LABEL: Record<ClientApprovalEventType, string> = {
  submitted: 'Information sent for review',
  resubmitted: 'Information sent again',
  approved: 'Approved',
  auto_approved: 'Approved automatically',
  changes_requested: 'Changes requested',
  rejected: 'Not approved',
};

export const STATUS_BADGE_CLASS: Record<ClientApprovalStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  awaiting_confirmation: 'border-info/40 bg-info/10 text-info',
  changes_requested: 'border-warning/50 bg-warning/10 text-warning',
  approved: 'border-success/40 bg-success/10 text-success',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/** True when the account may create requests and book sessions (the database enforces the same rule). */
export function canCreateRequests(a: Pick<ClientApproval, 'status' | 'required'> | null | undefined): boolean {
  return !a || !a.required || a.status === 'approved';
}

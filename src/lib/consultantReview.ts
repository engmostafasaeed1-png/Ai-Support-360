// What an administrator needs to review a consultant: the statuses, the decisions that can be taken from each status,
// the safe address of a link and the certificate files (private bucket "consultant-documents").

export const VERIFICATION_STATES = ['pending', 'under_review', 'on_hold', 'verified', 'rejected', 'suspended'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export function isVerificationState(value: unknown): value is VerificationState {
  return typeof value === 'string' && (VERIFICATION_STATES as readonly string[]).includes(value);
}

export const STATE_LABELS: Record<VerificationState, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  on_hold: 'On hold',
  verified: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

/** Tailwind classes of the small status badge. */
export const STATE_TONES: Record<VerificationState, string> = {
  pending: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  under_review: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  on_hold: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  verified: 'bg-green-500/10 text-green-600 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-600 border-red-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export interface StatusFilter {
  key: string;
  label: string;
  statuses: VerificationState[];
}

/** The groups of consultants that the approvals page can show. */
export const STATUS_FILTERS: StatusFilter[] = [
  { key: 'review', label: 'To review', statuses: ['pending', 'under_review'] },
  { key: 'on_hold', label: 'On hold', statuses: ['on_hold'] },
  { key: 'verified', label: 'Verified', statuses: ['verified'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'suspended', label: 'Suspended', statuses: ['suspended'] },
];

export interface DecisionOption {
  to: VerificationState;
  /** The text of the button in the list. */
  label: string;
  /** The title of the box that asks for a note. */
  title: string;
  placeholder: string;
  /** What is shown after the decision was saved. */
  done: string;
  tone: 'primary' | 'danger' | 'neutral';
}

const START_REVIEW: DecisionOption = { to: 'under_review', label: 'Start review', title: 'Start the review', placeholder: 'e.g. Checking the documents and the profiles.', done: 'The review has started.', tone: 'neutral' };
const BACK_TO_REVIEW: DecisionOption = { to: 'under_review', label: 'Back to review', title: 'Put back into review', placeholder: 'e.g. New documents were sent.', done: 'The consultant is under review again.', tone: 'neutral' };
const RECONSIDER: DecisionOption = { to: 'under_review', label: 'Reconsider', title: 'Reconsider the application', placeholder: 'e.g. The missing certificate was added.', done: 'The application is under review again.', tone: 'neutral' };
const HOLD: DecisionOption = { to: 'on_hold', label: 'Put on hold', title: 'Put on hold', placeholder: 'e.g. Waiting for a document from the consultant.', done: 'The consultant is on hold.', tone: 'neutral' };
const REJECT: DecisionOption = { to: 'rejected', label: 'Reject', title: 'Reject consultant', placeholder: 'e.g. Insufficient experience, missing certifications.', done: 'Consultant rejected.', tone: 'danger' };
const APPROVE: DecisionOption = { to: 'verified', label: 'Approve', title: 'Approve consultant', placeholder: 'e.g. Documents verified, certifications confirmed.', done: 'Consultant approved!', tone: 'primary' };
const SUSPEND: DecisionOption = { to: 'suspended', label: 'Suspend', title: 'Suspend consultant', placeholder: 'e.g. Complaint under investigation.', done: 'Consultant suspended.', tone: 'danger' };
const REINSTATE: DecisionOption = { to: 'verified', label: 'Reinstate', title: 'Reinstate consultant', placeholder: 'e.g. The complaint was resolved.', done: 'Consultant reinstated.', tone: 'primary' };

/** The decisions an administrator can take for a consultant with this status, in the order of the buttons (careful ones first, the approval last). */
export function decisionOptions(status: VerificationState): DecisionOption[] {
  switch (status) {
    case 'pending':
      return [START_REVIEW, HOLD, REJECT, APPROVE];
    case 'under_review':
      return [HOLD, REJECT, APPROVE];
    case 'on_hold':
      return [BACK_TO_REVIEW, REJECT, APPROVE];
    case 'verified':
      return [HOLD, SUSPEND];
    case 'rejected':
      return [RECONSIDER];
    case 'suspended':
      return [BACK_TO_REVIEW, REINSTATE];
  }
}

/** How many consultants there are for every status (a status that the database does not know is not counted). */
export function countByStatus(rows: Array<{ verification_status: string | null }>): Record<VerificationState, number> {
  const counts = { pending: 0, under_review: 0, on_hold: 0, verified: 0, rejected: 0, suspended: 0 } as Record<VerificationState, number>;
  for (const row of rows) {
    if (isVerificationState(row.verification_status)) counts[row.verification_status] += 1;
  }
  return counts;
}

/** The number of consultants in a group of the approvals page. */
export function countForFilter(counts: Record<VerificationState, number>, filter: StatusFilter): number {
  return filter.statuses.reduce((sum, status) => sum + counts[status], 0);
}

/** The address of a link if it is an http or https address, otherwise null (never "javascript:" or similar). */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export const CERT_BUCKET = 'consultant-documents';
export const CERT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'];
export const MAX_CERT_BYTES = 10 * 1024 * 1024;

/** Why a certificate file can not be used, or null when it is fine (a PDF, JPG or PNG of at most 10 MB). */
export function certificateFileProblem(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!CERT_EXTENSIONS.includes(extension)) return 'Choose a PDF, JPG or PNG file.';
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > MAX_CERT_BYTES) return 'The file is larger than 10 MB.';
  return null;
}

/**
 * The path of a certificate file inside the private bucket. New certificates store the path itself; older ones may hold the
 * address of the file in the bucket, so the path is taken from it. Anything that is not a file of this bucket gives null.
 */
export function certificateDocumentPath(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    const marker = `/${CERT_BUCKET}/`;
    const at = text.indexOf(marker);
    if (at < 0) return null;
    const rest = text.slice(at + marker.length).split(/[?#]/)[0];
    try {
      return decodeURIComponent(rest) || null;
    } catch {
      return null;
    }
  }
  return text.replace(/^\/+/, '') || null;
}

/** What kind of file a certificate path points to: a PDF, an image or something else. */
export function certificateFileKind(path: string | null | undefined): 'pdf' | 'image' | 'other' {
  const dot = (path ?? '').lastIndexOf('.');
  const extension = dot >= 0 ? (path ?? '').slice(dot + 1).toLowerCase() : '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png') return 'image';
  return 'other';
}

import type { FeedbackPriority, FeedbackSeverity, FeedbackStatus, FeedbackType } from '@/lib/feedback';

export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = { bug: 'Bug', idea: 'Improvement idea', question: 'Question', compliment: 'Compliment' };
export const FEEDBACK_SEVERITY_LABEL: Record<FeedbackSeverity, string> = { blocks: 'Blocks me', annoying: 'Annoying', minor: 'Minor' };
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New', triaged: 'Seen', in_progress: 'In progress', fixed: 'Fixed', wont_fix: "Won't fix", duplicate: 'Duplicate',
};
export const FEEDBACK_PRIORITY_LABEL: Record<FeedbackPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const FEEDBACK_STATUS_TONE: Record<FeedbackStatus, string> = {
  new: 'border-primary/40 text-primary',
  triaged: 'border-border text-foreground',
  in_progress: 'border-warning/50 text-warning',
  fixed: 'border-success/50 text-success',
  wont_fix: 'border-border text-muted-foreground',
  duplicate: 'border-border text-muted-foreground',
};

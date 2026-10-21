/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
  /** Optional one-piece HTML renderer (avoids split multi-byte letters in long Arabic mails); otherwise renderAsync. */
  html?: (data: Record<string, any>) => string
  /** Optional hand-written plain-text alternative; otherwise it is derived from the HTML. */
  text?: (data: Record<string, any>) => string
}

import { template as demoRequestReceived } from './demo-request-received.tsx'
import { template as demoRequestAlert } from './demo-request-alert.tsx'
import { template as contactMessageReceived } from './contact-message-received.tsx'
import { template as demoRescheduleReceived } from './demo-reschedule-received.tsx'
import { template as demoRescheduleConfirmed } from './demo-reschedule-confirmed.tsx'
import { template as interviewInvitation } from './interview-invitation.tsx'
import { template as interviewInvitationCopy } from './interview-invitation-copy.tsx'
import { template as interviewResponse } from './interview-response.tsx'
import { template as platformInvitation } from './platform-invitation.tsx'
import { template as criticalRequestAlert } from './critical-request-alert.tsx'
import { template as verificationItems } from './verification-items.tsx'
import { template as payoutApproved } from './payout-approved.tsx'
import { template as adminNotification } from './admin-notification.tsx'
import { template as profileReminder } from './profile-reminder.tsx'
import { template as assignmentRequest } from './assignment-request.tsx'
import { template as assignmentNoResponse } from './assignment-no-response.tsx'
import { template as responsivenessNotice } from './responsiveness-notice.tsx'
import { arabicPreviewTemplate as consultantPolicyNoticeAr, template as consultantPolicyNotice } from './consultant-policy-notice.tsx'
import { template as assignmentInfo } from './assignment-info.tsx'
import { template as feedbackReply } from './feedback-reply.tsx'
import { template as availabilityUrgent } from './availability-urgent.tsx'
import { template as holdEnded } from './hold-ended.tsx'
import { template as meetingInvitation } from './meeting-invitation.tsx'
import { template as referralNotice } from './referral-notice.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'admin-notification': adminNotification,
  'payout-approved': payoutApproved,
  'demo-request-received': demoRequestReceived,
  'demo-request-alert': demoRequestAlert,
  'contact-message-received': contactMessageReceived,
  'demo-reschedule-received': demoRescheduleReceived,
  'demo-reschedule-confirmed': demoRescheduleConfirmed,
  'interview-invitation': interviewInvitation,
  'interview-invitation-copy': interviewInvitationCopy,
  'interview-response': interviewResponse,
  'verification-items': verificationItems,
  'platform-invitation': platformInvitation,
  'critical-request-alert': criticalRequestAlert,
  'profile-reminder': profileReminder,
  'assignment-request': assignmentRequest,
  'assignment-no-response': assignmentNoResponse,
  'assignment-info': assignmentInfo,
  'responsiveness-notice': responsivenessNotice,
  'consultant-policy-notice': consultantPolicyNotice,
  'consultant-policy-notice-ar-preview': consultantPolicyNoticeAr,
  'feedback-reply': feedbackReply,
  'availability-urgent': availabilityUrgent,
  'hold-ended': holdEnded,
  'meeting-invitation': meetingInvitation,
  'referral-notice': referralNotice,
}

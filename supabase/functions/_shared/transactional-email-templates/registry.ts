/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
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

export const TEMPLATES: Record<string, TemplateEntry> = {
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
}

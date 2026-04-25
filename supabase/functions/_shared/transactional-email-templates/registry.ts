/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as demoRescheduleReceived } from './demo-reschedule-received.tsx'
import { template as demoRescheduleConfirmed } from './demo-reschedule-confirmed.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'demo-reschedule-received': demoRescheduleReceived,
  'demo-reschedule-confirmed': demoRescheduleConfirmed,
}

import { buildDemoUpdateView } from '../demoSchedule.ts'
import { demoTemplate } from './demo-email-view.tsx'

// Confirmation to the person who booked a demo, in their language and time zone (_shared/demoSchedule.ts).
export const template = demoTemplate('Demo request received (requester)', buildDemoUpdateView({
  id: '00000000-0000-0000-0000-000000000001', request_token: 'a'.repeat(32), demo_type: 'live', scheduling_preference: 'asap',
  scheduled_date: '2026-11-03', scheduled_slot: '10:00', timezone: 'Europe/London', meeting_format: 'video',
  full_name: 'Jane Doe', email: 'jane@company.com', language: 'en', created_at: '2026-11-01T09:00:00Z',
}, 'received', { site: 'https://www.aisupport360.com', now: new Date('2026-11-01T09:01:00Z') }))

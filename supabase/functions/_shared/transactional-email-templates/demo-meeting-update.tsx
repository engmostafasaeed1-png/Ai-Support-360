import { buildDemoUpdateView } from '../demoSchedule.ts'
import { demoTemplate } from './demo-email-view.tsx'

// Demo confirmed / new time / cancelled, sent to the requester when an admin acts on the Demo requests page.
export const template = demoTemplate('Demo meeting confirmed / changed / cancelled (requester)', buildDemoUpdateView({
  id: '00000000-0000-0000-0000-000000000001', request_token: 'a'.repeat(32), demo_type: 'live', timezone: 'Europe/London', meeting_format: 'video',
  full_name: 'Jane Doe', email: 'jane@company.com', language: 'en', created_at: '2026-11-01T09:00:00Z',
  meeting_at: '2026-11-03T10:00:00Z', meeting_duration_min: 30, meeting_link: 'https://meet.example.com/abc',
}, 'confirmed', { site: 'https://www.aisupport360.com', now: new Date('2026-11-01T09:30:00Z'), note: 'We will show the FI-AA runs first.' }))

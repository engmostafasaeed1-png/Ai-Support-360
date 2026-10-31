import { TEAM_EMAIL } from '../contact.ts'
import { DEMO_ALERT_DEFAULTS, buildDemoAlertView } from '../demoSchedule.ts'
import { demoTemplate } from './demo-email-view.tsx'

// Admin alert "Demo booked: schedule needed" (also its reminders and the website-message variant), sent to the team
// notification address once per request (dsa_alert_claim). Content: _shared/demoSchedule.ts buildDemoAlertView.
export const template = demoTemplate('Demo booked: schedule needed (team)', buildDemoAlertView({
  id: '00000000-0000-0000-0000-000000000001', request_token: 'a'.repeat(32), demo_type: 'module-deep-dive', scheduling_preference: 'this-week',
  scheduled_date: '2026-11-03', scheduled_slot: '10:00', timezone: 'Europe/London', meeting_format: 'video',
  full_name: 'Jane Doe', email: 'jane@company.com', company: 'Acme GmbH', requester_role: 'SAP FI lead', phone: '+44 20 7946 0000',
  sap_area: 'FI-AA', language: 'en', notes: 'We want to see the FI-AA depreciation runs.', source: 'landing-wizard',
  created_at: '2026-11-01T09:00:00Z', respond_by: '2026-11-01T10:00:00Z',
}, { site: 'https://www.aisupport360.com', settings: DEMO_ALERT_DEFAULTS, now: new Date('2026-11-01T09:01:00Z'), kind: 'alert' }), TEAM_EMAIL)

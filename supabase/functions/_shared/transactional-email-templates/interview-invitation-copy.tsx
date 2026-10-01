import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Link, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'AI SAP Support Now'

interface Props {
  organizerName?: string
  invited?: string[]
  candidateName?: string | null
  whenUtc?: string | null
  durationMinutes?: number
  meetingUrl?: string
  googleUrl?: string | null
  outlookUrl?: string | null
  updated?: boolean
}

const InterviewInvitationCopyEmail = ({
  organizerName,
  invited = [],
  candidateName,
  whenUtc,
  durationMinutes,
  meetingUrl,
  googleUrl,
  outlookUrl,
  updated,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{updated ? 'Copy: a live interview was rescheduled' : 'Copy: live interview invitation'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {updated ? 'Copy: a live interview was rescheduled' : 'Copy: live interview invitation'}
        </Heading>
        <Text style={text}>
          {organizerName || 'Our team'} copied you on an invitation to a live interview
          {candidateName ? ` with ${candidateName}` : ''} on {SITE_NAME}. This is for your information: the invited people answer for themselves.
        </Text>

        <Section style={card}>
          {invited.length > 0 && <Text style={cardTitle}>Invited</Text>}
          {invited.map((name, i) => (
            <Text key={i} style={slot}>• {name}</Text>
          ))}
          <Text style={{ ...cardTitle, margin: '14px 0 8px' }}>When</Text>
          <Text style={slot}>{whenUtc || 'No fixed time yet. The room is open.'}</Text>
          {durationMinutes ? <Text style={slot}>Length: {durationMinutes} minutes</Text> : null}
          <Text style={{ ...cardTitle, margin: '14px 0 8px' }}>Video call (free, opens in your browser)</Text>
          <Text style={slot}>
            <Link href={meetingUrl} style={link}>{meetingUrl}</Link>
          </Text>
        </Section>

        {(googleUrl || outlookUrl) && (
          <Text style={small}>
            Add it to your calendar:{' '}
            {googleUrl ? <Link href={googleUrl} style={link}>Google Calendar</Link> : null}
            {googleUrl && outlookUrl ? ' · ' : null}
            {outlookUrl ? <Link href={outlookUrl} style={link}>Outlook</Link> : null}
          </Text>
        )}
        <Text style={small}>
          You can reply to this e-mail: your reply goes straight to {organizerName || 'the organizer'}.
        </Text>

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: InterviewInvitationCopyEmail,
  subject: (data: Record<string, any>) =>
    data.updated ? 'Copy: a live interview was rescheduled' : 'Copy: live interview invitation',
  displayName: 'Interview invitation copy',
  previewData: {
    organizerName: 'Alex Admin',
    invited: ['Jane Doe (candidate)', 'Sam Lee (interviewer)'],
    candidateName: 'Jane Doe',
    whenUtc: 'Thursday 8 October 2026 at 06:00 UTC',
    durationMinutes: 60,
    meetingUrl: 'https://meet.jit.si/qurtuba-interview-0123456789abcdef0123456789abcdef',
    googleUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
    outlookUrl: 'https://outlook.live.com/calendar/0/deeplink/compose',
    updated: false,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 20px' }
const card = { background: '#f8fafc', borderRadius: '10px', padding: '16px 18px', margin: '0 0 20px' }
const cardTitle = { fontSize: '13px', fontWeight: 'bold', color: '#0f172a', textTransform: 'uppercase' as const, margin: '0 0 8px', letterSpacing: '0.04em' }
const slot = { fontSize: '14px', color: '#334155', margin: '4px 0', wordBreak: 'break-all' as const }
const link = { color: '#2563eb', textDecoration: 'underline' }
const small = { fontSize: '12px', color: '#64748b', lineHeight: '1.6', margin: '0 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

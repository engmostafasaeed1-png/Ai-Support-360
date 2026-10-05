import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'AI SAP Support Now'

interface Props {
  recipientName?: string
  organizerName?: string
  role?: string
  candidateName?: string | null
  whenUtc?: string | null
  whenLocal?: string | null
  durationMinutes?: number
  meetingUrl?: string
  roomUrl?: string
  acceptUrl?: string
  rescheduleUrl?: string
  declineUrl?: string
  googleUrl?: string | null
  outlookUrl?: string | null
  updated?: boolean
}

const InterviewInvitationEmail = ({
  recipientName,
  organizerName,
  role,
  candidateName,
  whenUtc,
  whenLocal,
  durationMinutes,
  meetingUrl,
  roomUrl,
  acceptUrl,
  rescheduleUrl,
  declineUrl,
  googleUrl,
  outlookUrl,
  updated,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {updated ? 'Your live interview was rescheduled' : 'You are invited to a live interview'}: please let us know if you can join
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {updated ? 'Your live interview was rescheduled' : 'You are invited to a live interview'}
        </Heading>
        <Text style={text}>
          Hello {recipientName || 'there'}, {organizerName || 'our team'} invited you to a live interview on {SITE_NAME}
          {role === 'interviewer'
            ? candidateName
              ? ` as an interviewer for ${candidateName}.`
              : ' as an interviewer.'
            : role === 'candidate'
              ? ' as the candidate.'
              : '.'}
        </Text>

        <Section style={card}>
          <Text style={cardTitle}>When</Text>
          <Text style={slot}>{whenUtc || 'No fixed time yet. The room is open, join when you are ready.'}</Text>
          {whenLocal && <Text style={slot}>Your time: {whenLocal}</Text>}
          {durationMinutes ? <Text style={slot}>Length: {durationMinutes} minutes</Text> : null}
          <Text style={{ ...cardTitle, margin: '14px 0 8px' }}>Video call (free, opens in your browser)</Text>
          <Text style={slot}>
            <Link href={meetingUrl} style={link}>{meetingUrl}</Link>
          </Text>
        </Section>

        <Text style={text}>Please let us know if you can join:</Text>
        <Section style={{ textAlign: 'center', margin: '8px 0 4px' }}>
          <Button href={acceptUrl} style={acceptButton}>Accept</Button>
        </Section>
        <Section style={{ textAlign: 'center', margin: '8px 0' }}>
          <Button href={rescheduleUrl} style={otherButton}>Suggest another time</Button>
        </Section>
        <Section style={{ textAlign: 'center', margin: '8px 0 20px' }}>
          <Button href={declineUrl} style={declineButton}>Decline</Button>
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
          You can also reply to this e-mail: your reply goes straight to {organizerName || 'the organizer'}.
          The interview room, with chat, is here: <Link href={roomUrl} style={link}>{roomUrl}</Link>
        </Text>

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: InterviewInvitationEmail,
  subject: (data: Record<string, any>) =>
    data.updated ? 'Your live interview was rescheduled' : 'You are invited to a live interview',
  displayName: 'Interview invitation',
  previewData: {
    recipientName: 'Jane Doe',
    organizerName: 'Alex Admin',
    role: 'candidate',
    candidateName: 'Jane Doe',
    whenUtc: 'Thursday 8 October 2026 at 06:00 UTC',
    whenLocal: 'Thursday 8 October 2026 at 09:00 (Asia/Riyadh)',
    durationMinutes: 60,
    meetingUrl: 'https://meet.jit.si/qurtuba-interview-0123456789abcdef0123456789abcdef',
    roomUrl: 'https://www.aisupport360.com/interview/live/00000000-0000-0000-0000-000000000000',
    acceptUrl: 'https://www.aisupport360.com/interview/respond/token?a=accept',
    rescheduleUrl: 'https://www.aisupport360.com/interview/respond/token?a=reschedule',
    declineUrl: 'https://www.aisupport360.com/interview/respond/token?a=decline',
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
const baseButton = { borderRadius: '8px', padding: '12px 24px', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const acceptButton = { ...baseButton, backgroundColor: '#16a34a', color: '#ffffff' }
const otherButton = { ...baseButton, backgroundColor: '#0f172a', color: '#ffffff' }
const declineButton = { ...baseButton, backgroundColor: '#ffffff', color: '#b91c1c', border: '1px solid #b91c1c' }
const small = { fontSize: '12px', color: '#64748b', lineHeight: '1.6', margin: '0 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

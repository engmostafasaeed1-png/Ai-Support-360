import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'AI SAP Support Now'

interface Props {
  organizerName?: string
  responderName?: string
  responderRole?: string
  response?: 'accepted' | 'declined' | 'reschedule_requested'
  whenUtc?: string | null
  proposedSlots?: string[]
  note?: string | null
  roomUrl?: string
}

const headline = (name: string, response?: string) =>
  response === 'accepted'
    ? `${name} accepted the live interview`
    : response === 'declined'
      ? `${name} declined the live interview`
      : `${name} asked for another time`

const InterviewResponseEmail = ({
  organizerName,
  responderName,
  responderRole,
  response,
  whenUtc,
  proposedSlots = [],
  note,
  roomUrl,
}: Props) => {
  const who = responderName || 'A participant'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{headline(who, response)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{headline(who, response)}</Heading>
          <Text style={text}>
            Hello {organizerName || 'there'}, {who}
            {responderRole ? ` (${responderRole})` : ''}{' '}
            {response === 'accepted'
              ? `accepted your invitation${whenUtc ? ` for ${whenUtc}` : ''}.`
              : response === 'declined'
                ? `declined your invitation${whenUtc ? ` for ${whenUtc}` : ''}.`
                : `cannot join${whenUtc ? ` at ${whenUtc}` : ''} and suggested other times.`}
          </Text>

          {response === 'reschedule_requested' && proposedSlots.length > 0 && (
            <Section style={card}>
              <Text style={cardTitle}>Suggested times (UTC)</Text>
              {proposedSlots.map((s, i) => (
                <Text key={i} style={slot}>• {s}</Text>
              ))}
            </Section>
          )}

          {note && (
            <Section style={card}>
              <Text style={cardTitle}>Note</Text>
              <Text style={slot}>{note}</Text>
            </Section>
          )}

          {roomUrl && (
            <Section style={{ textAlign: 'center', margin: '24px 0' }}>
              <Button href={roomUrl} style={button}>
                {response === 'reschedule_requested' ? 'Pick a new time' : 'Open the interview'}
              </Button>
            </Section>
          )}

          <Text style={small}>
            You can reply to this e-mail: your reply goes straight to {who}.
          </Text>
          <Text style={footer}>— The {SITE_NAME} team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: InterviewResponseEmail,
  subject: (data: Record<string, any>) => headline(data.responderName || 'A participant', data.response),
  displayName: 'Interview response',
  previewData: {
    organizerName: 'Alex Admin',
    responderName: 'Jane Doe',
    responderRole: 'candidate',
    response: 'reschedule_requested',
    whenUtc: 'Thursday 8 October 2026 at 06:00 UTC',
    proposedSlots: ['Friday 9 October 2026 at 07:00 UTC', 'Monday 12 October 2026 at 08:00 UTC'],
    note: 'I have a client call at that time.',
    roomUrl: 'https://www.aisapsupportnow.com/interview/live/00000000-0000-0000-0000-000000000000',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 20px' }
const card = { background: '#f8fafc', borderRadius: '10px', padding: '16px 18px', margin: '0 0 16px' }
const cardTitle = { fontSize: '13px', fontWeight: 'bold', color: '#0f172a', textTransform: 'uppercase' as const, margin: '0 0 8px', letterSpacing: '0.04em' }
const slot = { fontSize: '14px', color: '#334155', margin: '4px 0' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 24px', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '12px', color: '#64748b', margin: '0 0 12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

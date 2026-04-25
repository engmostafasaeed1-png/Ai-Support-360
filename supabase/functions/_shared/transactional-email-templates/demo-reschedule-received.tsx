import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Qurtuba Talks'

interface Props {
  name?: string
  confirmationUrl?: string
  proposedSlots?: Array<{ date?: string; time?: string }>
  reason?: string
}

const DemoRescheduleReceivedEmail = ({
  name,
  confirmationUrl,
  proposedSlots = [],
  reason,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>We received your reschedule request — awaiting confirmation</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `Thanks, ${name}!` : 'Thanks!'}
        </Heading>
        <Text style={text}>
          We received your request to reschedule your demo with {SITE_NAME}.
          Our team will review your proposed times and confirm the final
          slot shortly.
        </Text>

        {proposedSlots.length > 0 && (
          <Section style={card}>
            <Text style={cardTitle}>Your proposed times</Text>
            {proposedSlots.map((s, i) => (
              <Text key={i} style={slot}>
                • {s.date ?? '—'} at {s.time ?? '—'}
              </Text>
            ))}
          </Section>
        )}

        {reason && (
          <Section style={card}>
            <Text style={cardTitle}>Your note</Text>
            <Text style={slot}>{reason}</Text>
          </Section>
        )}

        {confirmationUrl && (
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button href={confirmationUrl} style={button}>
              View your request
            </Button>
            <Text style={small}>
              You can update your proposed slots anytime from this link.
            </Text>
          </Section>
        )}

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DemoRescheduleReceivedEmail,
  subject: 'Your reschedule request — awaiting confirmation',
  displayName: 'Demo reschedule received',
  previewData: {
    name: 'Jane Doe',
    confirmationUrl: 'https://example.com/demo/confirmation?token=abc123',
    proposedSlots: [
      { date: '2026-05-01', time: '10:00' },
      { date: '2026-05-02', time: '14:00' },
    ],
    reason: 'Conflicting meeting at the original time.',
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
const small = { fontSize: '12px', color: '#64748b', margin: '12px 0 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Qurtuba Talks'

interface Props {
  name?: string
  confirmationUrl?: string
  scheduledDate?: string
  scheduledSlot?: string
  timezone?: string
}

const DemoRescheduleConfirmedEmail = ({
  name,
  confirmationUrl,
  scheduledDate,
  scheduledSlot,
  timezone,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your demo is rescheduled — final time confirmed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `You're all set, ${name}!` : "You're all set!"}
        </Heading>
        <Text style={text}>
          Your demo with {SITE_NAME} has been rescheduled. Here's your
          confirmed time:
        </Text>

        <Section style={card}>
          <Text style={cardTitle}>Confirmed time</Text>
          <Text style={slotMain}>
            {scheduledDate ?? '—'} at {scheduledSlot ?? '—'}
          </Text>
          {timezone && <Text style={small}>Timezone: {timezone}</Text>}
        </Section>

        {confirmationUrl && (
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button href={confirmationUrl} style={button}>
              View confirmation
            </Button>
            <Text style={small}>
              Need to change again? You can reschedule from this link.
            </Text>
          </Section>
        )}

        <Text style={footer}>Looking forward to chatting — the {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DemoRescheduleConfirmedEmail,
  subject: 'Your demo is rescheduled — confirmed',
  displayName: 'Demo reschedule confirmed',
  previewData: {
    name: 'Jane Doe',
    confirmationUrl: 'https://example.com/demo/confirmation?token=abc123',
    scheduledDate: 'May 02, 2026',
    scheduledSlot: '14:00',
    timezone: 'Europe/Madrid',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 20px' }
const card = { background: '#f0fdf4', borderRadius: '10px', padding: '18px 20px', margin: '0 0 16px', border: '1px solid #bbf7d0' }
const cardTitle = { fontSize: '12px', fontWeight: 'bold', color: '#15803d', textTransform: 'uppercase' as const, margin: '0 0 6px', letterSpacing: '0.06em' }
const slotMain = { fontSize: '18px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 4px' }
const small = { fontSize: '12px', color: '#64748b', margin: '4px 0 0' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 24px', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

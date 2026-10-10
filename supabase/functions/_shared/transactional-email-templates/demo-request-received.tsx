import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'AI Support 360'

interface Props {
  name?: string
  demoType?: string
  requestedDate?: string
  requestedSlot?: string
  preference?: string
  timezone?: string
  confirmationUrl?: string
}

const PREFERENCE_LABEL: Record<string, string> = {
  asap: 'As soon as possible',
  'this-week': 'This week',
  'next-week': 'Next week',
  flexible: 'Flexible',
}

const DemoRequestReceivedEmail = ({
  name,
  demoType,
  requestedDate,
  requestedSlot,
  preference,
  timezone,
  confirmationUrl,
}: Props) => {
  const when = requestedDate
    ? `${requestedDate}${requestedSlot ? ` at ${requestedSlot}` : ''}${timezone ? ` (${timezone})` : ''}`
    : preference
      ? (PREFERENCE_LABEL[preference] ?? preference)
      : undefined
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>We received your demo request</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {name ? `Thanks, ${name}!` : 'Thanks!'}
          </Heading>
          <Text style={text}>
            We received your demo request. Our team will confirm the final time with you by e-mail.
            Nothing is booked until you receive that confirmation.
          </Text>

          {(demoType || when) && (
            <Section style={card}>
              <Text style={cardTitle}>Your request</Text>
              {demoType && <Text style={line}>• {demoType}</Text>}
              {when && <Text style={line}>• Requested time: {when}</Text>}
            </Section>
          )}

          {confirmationUrl && (
            <Section style={{ textAlign: 'center', margin: '28px 0' }}>
              <Button href={confirmationUrl} style={button}>
                View your request
              </Button>
              <Text style={small}>
                You can follow the status of your request, or propose other times, from this link.
              </Text>
            </Section>
          )}

          <Text style={footer}>— The {SITE_NAME} team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: DemoRequestReceivedEmail,
  subject: 'We received your demo request',
  displayName: 'Demo request received',
  previewData: {
    name: 'Jane Doe',
    demoType: 'Live platform walkthrough',
    requestedDate: '2026-11-03',
    requestedSlot: '10:00',
    timezone: 'Europe/London',
    confirmationUrl: 'https://example.com/demo/confirmation/abc123',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 20px' }
const card = { background: '#f8fafc', borderRadius: '10px', padding: '16px 18px', margin: '0 0 16px' }
const cardTitle = { fontSize: '13px', fontWeight: 'bold', color: '#0f172a', textTransform: 'uppercase' as const, margin: '0 0 8px', letterSpacing: '0.04em' }
const line = { fontSize: '14px', color: '#334155', margin: '4px 0' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 24px', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '12px', color: '#64748b', margin: '12px 0 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

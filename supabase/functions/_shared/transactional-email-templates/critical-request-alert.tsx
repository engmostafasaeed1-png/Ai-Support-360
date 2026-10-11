import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  name?: string
  title?: string
  areas?: string
  minutes?: number
  percent?: number
  until?: string
  updated?: boolean
  url?: string
}

const CriticalRequestAlertEmail = ({
  name,
  title = 'A client needs urgent help',
  areas = 'SAP',
  minutes = 30,
  percent = 30,
  until = '',
  updated,
  url = 'https://www.aisupport360.com/consultant/open-tickets',
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${updated ? 'Updated critical request' : 'Critical request'}: reply within ${minutes} minutes for +${percent}% on your hourly rate`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{updated ? 'Updated critical request' : 'Critical request: a client needs an immediate reply'}</Heading>
        <Text style={text}>
          {`Hello ${name || 'there'}, a client needs urgent help with ${areas}. ${updated ? 'The client changed the terms. ' : ''}Reply with a proposal within ${minutes} minutes${until ? ` (before ${until})` : ''} and your hourly rate gets +${percent}% on this ticket.`}
        </Text>
        <Section style={box}>
          <Text style={boxTitle}>{title}</Text>
          <Text style={boxText}>{`Reply window: ${minutes} minutes - Surcharge for you: +${percent}%`}</Text>
        </Section>
        <Button href={url} style={button}>Open the request and reply</Button>
        <Text style={small}>
          You get this e-mail because you are a verified consultant who covers this SAP area and have new-case alerts switched on. The surcharge applies only to a proposal that is sent inside the reply window and accepted by the client. You set your own rate.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CriticalRequestAlertEmail,
  subject: (d: Record<string, any>) =>
    `${d.updated ? 'UPDATED critical request' : 'CRITICAL request'} - reply within ${d.minutes ?? 30} minutes (+${d.percent ?? 30}%)`,
  displayName: 'Critical request alert (consultant)',
  previewData: { name: 'Sara', title: 'Posting fails after the upgrade', areas: 'SAP FI/CO', minutes: 30, percent: 30, until: '14:30 UTC' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#b91c1c', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#fef2f2', borderRadius: '12px', padding: '12px 16px', margin: '0 0 20px' }
const boxTitle = { fontSize: '15px', fontWeight: 'bold', color: '#1B2559', margin: '0 0 4px' }
const boxText = { fontSize: '13px', color: '#475569', margin: '0' }
const button = { backgroundColor: '#dc2626', color: '#ffffff', borderRadius: '12px', padding: '12px 20px', fontSize: '15px', textDecoration: 'none' }
const small = { fontSize: '12px', color: '#64748b', lineHeight: '1.5', margin: '20px 0 0' }

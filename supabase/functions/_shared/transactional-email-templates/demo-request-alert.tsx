import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { TEAM_EMAIL } from '../contact.ts'

const SITE_NAME = 'AI Support 360'

interface Props {
  name?: string
  email?: string
  company?: string
  demoType?: string
  when?: string
  source?: string
  notes?: string
  adminUrl?: string
}

const DemoRequestAlertEmail = ({ name, email, company, demoType, when, source, notes, adminUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`New request from ${name ?? 'a visitor'}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {source === 'contact-form' ? 'New message from the website' : 'New demo request'}
        </Heading>
        <Section style={card}>
          <Text style={line}>Name: {name}</Text>
          <Text style={line}>E-mail: {email}</Text>
          {company && <Text style={line}>Company: {company}</Text>}
          {demoType && <Text style={line}>Request: {demoType}</Text>}
          {when && <Text style={line}>Requested time: {when}</Text>}
          {source && <Text style={line}>Form: {source}</Text>}
        </Section>

        {notes && (
          <Section style={card}>
            <Text style={cardTitle}>Message</Text>
            <Text style={line}>{notes}</Text>
          </Section>
        )}

        {adminUrl && (
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button href={adminUrl} style={button}>
              Open the requests page
            </Button>
          </Section>
        )}

        <Text style={small}>Reply to this e-mail to answer the visitor directly.</Text>
        <Text style={footer}>— {SITE_NAME}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DemoRequestAlertEmail,
  subject: (data: Record<string, any>) =>
    data.source === 'contact-form'
      ? `New website message from ${data.name ?? 'a visitor'}`
      : `New demo request from ${data.name ?? 'a visitor'}`,
  to: TEAM_EMAIL,
  displayName: 'Demo request alert (team)',
  previewData: {
    name: 'Jane Doe',
    email: 'jane@company.com',
    company: 'Acme GmbH',
    demoType: 'Live platform walkthrough',
    when: '2026-11-03 at 10:00 (Europe/London)',
    source: 'landing-wizard',
    notes: 'We want to see the FI-AA depreciation runs.',
    adminUrl: 'https://example.com/admin/demo-requests',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const card = { background: '#f8fafc', borderRadius: '10px', padding: '14px 18px', margin: '0 0 16px' }
const cardTitle = { fontSize: '13px', fontWeight: 'bold', color: '#0f172a', textTransform: 'uppercase' as const, margin: '0 0 8px', letterSpacing: '0.04em' }
const line = { fontSize: '14px', color: '#334155', margin: '4px 0', whiteSpace: 'pre-wrap' as const }
const button = { backgroundColor: '#0f172a', color: '#ffffff', borderRadius: '8px', padding: '12px 24px', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '12px', color: '#64748b', margin: '12px 0 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }

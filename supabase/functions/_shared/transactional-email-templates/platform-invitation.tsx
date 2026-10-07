import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  name?: string
  role?: 'consultant' | 'client'
  message?: string
  url?: string
}

/**
 * What each side can actually do once the account exists. Kept as a
 * factual capability list (no marketing claims) so the invitation stays
 * a transactional email about account setup.
 */
const CLIENT_CAPABILITIES = [
  'Describe SAP support requirements and review AI suggestions and relevant knowledge articles.',
  'Find consultants based on expertise, experience, language, availability, and rates.',
  'Review proposals and agree on rates and estimated effort.',
  'Schedule consultations using the available communication options.',
  'Review work records, approve timesheets, and track invoices.',
  'Manage NDAs and access to case information.',
]

const CONSULTANT_CAPABILITIES = [
  'Create a professional profile with skills, certifications, experience, and project history.',
  'Set availability and proposed hourly rates.',
  'Receive relevant support invitations and accept or decline them.',
  'Submit proposals with estimated effort and delivery timelines.',
  'Record work, submit timesheets, and communicate with clients.',
  'View recorded earnings, platform fees, and payout status.',
]

const Email = ({ name, role = 'client', message, url = 'https://www.aisupport360.com/signup' }: Props) => {
  const isConsultant = role === 'consultant'
  const capabilities = isConsultant ? CONSULTANT_CAPABILITIES : CLIENT_CAPABILITIES
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{isConsultant ? 'Your consultant account invitation — AI Support 360' : 'Your client account invitation — AI Support 360'}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandBar}><Text style={brandText}>AI Support 360</Text></Section>
          <Text style={accountLabel}>{isConsultant ? 'CONSULTANT INVITATION' : 'CLIENT INVITATION'}</Text>
          <Heading style={h1}>{name ? `Hi ${name}, you're invited` : "You're invited"}</Heading>
          <Text style={text}>
            {isConsultant
              ? 'Create your consultant account to complete your professional profile and manage assignments, availability, timesheets, and invoices.'
              : 'Create your client account to submit support requests and manage your tickets, approvals, and invoices.'}
          </Text>
          <Text style={sectionLabel}>
            {isConsultant ? 'IN YOUR CONSULTANT ACCOUNT YOU CAN' : 'IN YOUR CLIENT ACCOUNT YOU CAN'}
          </Text>
          <Section style={listBox}>
            {capabilities.map((line, i) => (
              <Text key={i} style={listItem}>
                <span style={bullet}>{'•'}</span> {line}
              </Text>
            ))}
          </Section>
          {message ? <Text style={quote}>“{message}”</Text> : null}
          <Section style={buttonWrap}>
            <Button style={button} href={url}>{isConsultant ? 'Create my consultant account' : 'Create my client account'}</Button>
          </Section>
          <Text style={fallback}>Or open this link: {url}</Text>
          <Text style={footer}>If you weren't expecting this invitation, you can ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => d.role === 'consultant' ? 'Your consultant account invitation — AI Support 360' : 'Your client account invitation — AI Support 360',
  displayName: 'Platform invitation',
  previewData: { name: 'Sara', role: 'consultant', message: 'We would love to have you on board.' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { backgroundColor: '#1B2559', borderRadius: '16px', padding: '16px 20px', marginBottom: '28px' }
const brandText = { color: '#ffffff', fontSize: '16px', fontWeight: 'bold' as const, margin: 0 }
const accountLabel = { color: '#475569', fontSize: '12px', fontWeight: 'bold' as const, margin: '0 0 12px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1B2559', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 16px' }
const sectionLabel = { color: '#1B2559', fontSize: '11px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: '0 0 10px' }
const listBox = { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px 18px', margin: '0 0 20px' }
const listItem = { fontSize: '14px', color: '#334155', lineHeight: '1.55', margin: '0 0 8px', padding: '0 0 0 18px', textIndent: '-18px' }
const bullet = { color: '#3B82F6', fontWeight: 'bold' as const, paddingRight: '8px' }
const quote = { fontSize: '14px', color: '#1B2559', fontStyle: 'italic' as const, borderLeft: '3px solid #3B82F6', paddingLeft: '12px', margin: '0 0 16px' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '14px', padding: '14px 28px', textDecoration: 'none' }
const fallback = { fontSize: '12px', color: '#94a3b8', wordBreak: 'break-all' as const }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }

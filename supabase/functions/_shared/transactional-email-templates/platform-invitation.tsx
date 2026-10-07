import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  name?: string
  role?: 'consultant' | 'client'
  message?: string
  url?: string
}

const Email = ({ name, role = 'client', message, url = 'https://www.aisupport360.com/signup' }: Props) => {
  const isConsultant = role === 'consultant'
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
const quote = { fontSize: '14px', color: '#1B2559', fontStyle: 'italic' as const, borderLeft: '3px solid #3B82F6', paddingLeft: '12px', margin: '0 0 16px' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '14px', padding: '14px 28px', textDecoration: 'none' }
const fallback = { fontSize: '12px', color: '#94a3b8', wordBreak: 'break-all' as const }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }

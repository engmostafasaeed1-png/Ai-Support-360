/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>{siteName}</Text>
        </Section>
        <Heading style={h1}>You've been invited 🎉</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Click the button below to accept and create your account.
        </Text>
        <Section style={buttonWrap}>
          <Button style={button} href={confirmationUrl}>
            Accept invitation
          </Button>
        </Section>
        <Text style={fallback}>Or copy this link into your browser:</Text>
        <Text style={fallbackLink}>{confirmationUrl}</Text>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
        <Text style={brandFooter}>{siteName} — Smart SAP Support Portal</Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { backgroundColor: '#1B2559', borderRadius: '16px', padding: '16px 20px', marginBottom: '28px' }
const brandText = { color: '#ffffff', fontSize: '16px', fontWeight: 'bold' as const, margin: 0, letterSpacing: '0.3px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1B2559', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 20px' }
const link = { color: '#3B82F6', textDecoration: 'underline' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0' }
const button = {
  backgroundColor: '#1B2559',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '14px',
  padding: '14px 28px',
  textDecoration: 'none',
  display: 'inline-block',
}
const fallback = { fontSize: '12px', color: '#94a3b8', margin: '20px 0 4px' }
const fallbackLink = { fontSize: '12px', color: '#3B82F6', wordBreak: 'break-all' as const, margin: '0 0 24px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }
const brandFooter = { fontSize: '11px', color: '#cbd5e1', margin: '20px 0 0', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }

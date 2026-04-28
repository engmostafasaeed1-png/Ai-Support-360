/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
  siteName?: string
}

export const ReauthenticationEmail = ({ token, siteName = 'Smart SAP Connect' }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {siteName} verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>{siteName}</Text>
        </Section>
        <Heading style={h1}>Confirm reauthentication</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can
          safely ignore this email.
        </Text>
        <Text style={brandFooter}>{siteName} — Smart SAP Support Portal</Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { backgroundColor: '#1B2559', borderRadius: '16px', padding: '16px 20px', marginBottom: '28px' }
const brandText = { color: '#ffffff', fontSize: '16px', fontWeight: 'bold' as const, margin: 0, letterSpacing: '0.3px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1B2559', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 20px' }
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#1B2559',
  letterSpacing: '4px',
  margin: '0 0 30px',
  backgroundColor: '#f1f5f9',
  padding: '16px 20px',
  borderRadius: '14px',
  textAlign: 'center' as const,
}
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }
const brandFooter = { fontSize: '11px', color: '#cbd5e1', margin: '20px 0 0', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }

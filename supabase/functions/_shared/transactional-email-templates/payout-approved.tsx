import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { name?: string; amount?: string; currency?: string; date?: string; completed?: boolean }

const PayoutApprovedEmail = ({ name, amount, currency, date, completed }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Your payout of ${amount ?? ''} ${currency ?? ''} ${completed ? 'was sent' : 'has been approved'}.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>AI Support 360</Text>
        <Heading style={heading}>{completed ? 'Your payout was sent' : 'Your payout is approved'}</Heading>
        <Text style={text}>{`Hello ${name || 'there'},`}</Text>
        <Text style={text}>{completed ? 'Your payout has been transferred. Your bank may take additional time to credit your account.' : 'Your payout has been approved and is being prepared for transfer.'}</Text>
        <Section style={details}>
          <Text style={text}>{`Amount: ${amount ?? '—'} ${currency ?? ''}`}</Text>
          <Text style={text}>{`${completed ? 'Payout date' : 'Expected payout date'}: ${date ?? '—'}`}</Text>
        </Section>
        <Button href="https://www.aisupport360.com/consultant/earnings" style={button}>View your earnings</Button>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PayoutApprovedEmail,
  subject: (data: Record<string, any>) => `AI Support 360 — Payout ${data.completed ? 'sent' : 'approved'}: ${data.amount ?? ''} ${data.currency ?? ''}`,
  displayName: 'Consultant payout approval',
  previewData: { name: 'Sara', amount: '250.00', currency: 'USD', date: '2026-10-29', completed: false },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const brand = { color: '#1B2559', fontSize: '14px', fontWeight: 'bold' }
const heading = { color: '#1B2559', fontSize: '24px', margin: '20px 0' }
const text = { color: '#334155', fontSize: '15px', lineHeight: '1.6' }
const details = { backgroundColor: '#f1f5f9', padding: '8px 20px', borderRadius: '8px', margin: '20px 0' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', padding: '12px 20px', borderRadius: '8px', fontSize: '15px' }
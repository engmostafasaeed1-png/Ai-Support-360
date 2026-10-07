import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'AI Support 360'

interface Item { label: string; due: string }
interface Props {
  name?: string
  reminder?: boolean
  items?: Item[]
  url?: string
}

const VerificationItemsEmail = ({ name, reminder, items = [], url = 'https://www.aisupport360.com/consultant/verification' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{reminder ? 'Your verification deadline is coming up' : 'Please complete your verification'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{reminder ? 'Your verification deadline is coming up' : 'Your profile is live — a few items to complete'}</Heading>
        <Text style={text}>
          Hello {name || 'there'}, {reminder
            ? 'these verification items are still open and due soon:'
            : `your ${SITE_NAME} profile was approved and now appears to clients. Please complete these items before the deadline:`}
        </Text>
        <Section style={box}>
          {items.map((i, n) => (
            <Text key={n} style={itemText}>• <strong>{i.label}</strong> — due {i.due}</Text>
          ))}
        </Section>
        <Button href={url} style={button}>Complete verification</Button>
        <Text style={small}>Update your profile, then press "Done" next to each item with a short note.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: VerificationItemsEmail,
  subject: (d: Record<string, any>) => d.reminder ? 'Reminder: verification items due soon' : 'Please complete your verification',
  displayName: 'Consultant verification items',
  previewData: { name: 'Sara', items: [{ label: 'Certificates', due: 'Oct 20, 2026' }] },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 20px' }
const itemText = { fontSize: '14px', color: '#1B2559', margin: '4px 0' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 20px', fontSize: '15px', textDecoration: 'none' }
const small = { fontSize: '13px', color: '#64748b', margin: '20px 0 0' }

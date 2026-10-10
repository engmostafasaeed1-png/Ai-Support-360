import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'AI Support 360'

interface Props {
  name?: string
}

const ContactMessageReceivedEmail = ({ name }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>We received your message</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{name ? `Thanks, ${name}!` : 'Thanks!'}</Heading>
        <Text style={text}>
          We received your message. Our team will answer you by e-mail. You can reply to this e-mail if you want to add something.
        </Text>
        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactMessageReceivedEmail,
  subject: 'We received your message',
  displayName: 'Contact message received',
  previewData: { name: 'Jane Doe' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 20px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0' }

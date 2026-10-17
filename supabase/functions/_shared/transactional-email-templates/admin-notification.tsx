import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { adminMailSubject } from '../admin-notification-email.ts'

interface Props { title?: string; body?: string; url?: string }
const Email = ({ title = 'Administrator notification', body = '', url = 'https://www.aisupport360.com/admin/notifications' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head /><Preview>{title}</Preview>
    <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }}>
      <Container style={{ maxWidth: '560px', padding: '32px 28px', margin: '0 auto' }}>
        <Text style={{ color: '#1B2559', fontWeight: 'bold' }}>AI Support 360</Text>
        <Heading style={{ color: '#1B2559', fontSize: '22px' }}>{title}</Heading>
        <Text style={{ color: '#334155', fontSize: '15px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{body}</Text>
        <Button href={url} style={{ backgroundColor: '#1B2559', color: '#ffffff', padding: '12px 20px', borderRadius: '8px' }}>Open notification</Button>
      </Container>
    </Body>
  </Html>
)
export const template = {
  component: Email,
  subject: (data: Record<string, any>) => adminMailSubject(String(data.title ?? 'Administrator notification')),
  displayName: 'Administrator notification',
  previewData: { title: 'New support request', body: 'A client submitted a support request.', url: 'https://www.aisupport360.com/admin/tickets' },
} satisfies TemplateEntry
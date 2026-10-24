import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { renderBrdApprovalEmail, sampleBrdApprovalEmail } from '../brdApprovalEmail.ts'

/**
 * BRD approval by the assigned consultant: request / reminder / FYI to the consultant, the outcome to the client,
 * declines and overdue approvals to administrators. One recipient per event (queued by the database). The shared
 * layout (_shared/brdApprovalEmail.ts) renders HTML and text in one piece; the component is only a fallback.
 */
const BrdApprovalEmail = (p: Record<string, unknown>) => {
  const r = renderBrdApprovalEmail(p as never)
  return (
    <Html lang={r.lang} dir={r.lang === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{r.preheader}</Preview>
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ padding: '24px' }}>
          <Heading style={{ fontSize: '20px', color: '#1B2559' }}>{r.subject}</Heading>
          <Text style={{ fontSize: '15px', color: '#334155', whiteSpace: 'pre-wrap' }}>{r.text}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BrdApprovalEmail,
  subject: (d: Record<string, any>) => renderBrdApprovalEmail(d as any).subject,
  html: (d: Record<string, any>) => renderBrdApprovalEmail(d as any).html,
  text: (d: Record<string, any>) => renderBrdApprovalEmail(d as any).text,
  displayName: 'BRD approval',
  previewData: { ...sampleBrdApprovalEmail('request', 'en') },
} satisfies TemplateEntry

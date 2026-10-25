import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { renderSlaEmail, sampleSlaEmail } from '../slaEmail.ts'

/**
 * SLA reminder / escalation / breach for one person on one ticket (queued by docs/sql/sla-policies.sql, sent by
 * sla-run). The shared layout (_shared/slaEmail.ts) renders HTML and text; the component is only a fallback.
 */
const SlaNoticeEmail = (p: Record<string, unknown>) => {
  const r = renderSlaEmail(p as never)
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
  component: SlaNoticeEmail,
  subject: (d: Record<string, any>) => renderSlaEmail(d as any).subject,
  html: (d: Record<string, any>) => renderSlaEmail(d as any).html,
  text: (d: Record<string, any>) => renderSlaEmail(d as any).text,
  displayName: 'SLA reminder',
  previewData: { ...sampleSlaEmail('reminder', 'en') },
} satisfies TemplateEntry

import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { renderAgreementEmail, sampleAgreementEmail } from '../agreementEmail.ts'

/** Support agreement event for one party (queued by docs/sql/support-agreements.sql, sent by agreement-run). */
const AgreementNoticeEmail = (p: Record<string, unknown>) => {
  const r = renderAgreementEmail(p as never)
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
  component: AgreementNoticeEmail,
  subject: (d: Record<string, any>) => renderAgreementEmail(d as any).subject,
  html: (d: Record<string, any>) => renderAgreementEmail(d as any).html,
  text: (d: Record<string, any>) => renderAgreementEmail(d as any).text,
  displayName: 'Support agreement notice',
  previewData: { ...sampleAgreementEmail('en') },
} satisfies TemplateEntry

import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { renderNdaEmail, sampleNdaEmail } from '../ndaEmail.ts'

/** NDA signing notice for one party (sent by the nda-signature function after a signature or a reminder). */
const NdaNoticeEmail = (p: Record<string, unknown>) => {
  const r = renderNdaEmail(p as never)
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
  component: NdaNoticeEmail,
  subject: (d: Record<string, any>) => renderNdaEmail(d as any).subject,
  html: (d: Record<string, any>) => renderNdaEmail(d as any).html,
  text: (d: Record<string, any>) => renderNdaEmail(d as any).text,
  displayName: 'NDA signature notice',
  previewData: { ...sampleNdaEmail('en') },
} satisfies TemplateEntry

import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { NOTICE_STR as STR, noticeCopy, type NoticeProps as Props } from '../responsivenessCopy.ts'

/** Feature M e-mail to the consultant: a request reached "No response" or a dispute was reviewed. Copy in ../responsivenessCopy.ts (shared with the popup). */

const ResponsivenessNoticeEmail = (props: Props) => {
  const l = props.lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const copy = noticeCopy(props)
  const url = props.pageUrl || 'https://www.aisupport360.com/consultant/responsiveness'
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{copy.title}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{copy.title}</Heading>
          <Text style={text}>{copy.body}</Text>
          {copy.showDispute && <Text style={text}>{t.dispute(Math.max(1, Number(props.disputeDays) || 7))}</Text>}
          <Section style={{ margin: '0 0 16px' }}>
            <Button href={url} style={primary}>{t.button}</Button>
          </Section>
          <Text style={small}>{t.improve}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ResponsivenessNoticeEmail,
  subject: (d: Record<string, any>) => noticeCopy(d as Props).title,
  displayName: 'Responsiveness notice (consultant)',
  previewData: { lang: 'en', kind: 'warning_1', ticketTitle: 'FB50 posting error after S/4HANA migration', count30: 1, warningsTotal: 2, disputeDays: 7 },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const primary = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 22px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#64748b', margin: '16px 0 0', lineHeight: '1.5' }

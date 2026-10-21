import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// Reply from the team to one person's own feedback report (sent only when they agreed to be contacted).
interface Props { title?: string; message?: string; lang?: 'en' | 'ar'; link?: string }

const COPY = {
  en: {
    preview: 'The AI Support 360 team replied to your feedback',
    heading: 'We replied to your feedback',
    about: 'About your report',
    cta: 'View my feedback',
    why: 'You receive this because you sent us feedback and allowed us to contact you about it.',
  },
  ar: {
    preview: 'رد فريق AI Support 360 على ملاحظتك',
    heading: 'رددنا على ملاحظتك',
    about: 'بخصوص بلاغك',
    cta: 'عرض ملاحظاتي',
    why: 'تصلك هذه الرسالة لأنك أرسلت لنا ملاحظة وسمحت لنا بالتواصل معك بشأنها.',
  },
}

const FeedbackReplyEmail = ({ title, message, lang = 'en', link }: Props) => {
  const c = COPY[lang === 'ar' ? 'ar' : 'en']
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return (
    <Html lang={lang === 'ar' ? 'ar' : 'en'} dir={dir}>
      <Head />
      <Preview>{c.preview}</Preview>
      <Body style={main}>
        <Container style={{ ...container, direction: dir, textAlign: lang === 'ar' ? 'right' : 'left' }}>
          <Text style={brand}>AI Support 360</Text>
          <Heading style={heading}>{c.heading}</Heading>
          <Text style={muted}>{`${c.about}: ${title || '—'}`}</Text>
          <Section style={quote}>
            <Text style={{ ...text, whiteSpace: 'pre-wrap' }}>{message || ''}</Text>
          </Section>
          <Button href={link || 'https://www.aisupport360.com/my-feedback'} style={button}>{c.cta}</Button>
          <Text style={small}>{c.why}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: FeedbackReplyEmail,
  subject: (data: Record<string, any>) => (data.lang === 'ar' ? 'رد على ملاحظتك — AI Support 360' : 'Reply to your feedback — AI Support 360'),
  displayName: 'Feedback reply',
  previewData: { title: 'Save button does nothing', message: 'Thank you! We found the cause and fixed it today.', lang: 'en' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const brand = { color: '#1B2559', fontSize: '14px', fontWeight: 'bold' }
const heading = { color: '#1B2559', fontSize: '24px', margin: '20px 0 8px' }
const text = { color: '#334155', fontSize: '15px', lineHeight: '1.6', margin: '0' }
const muted = { color: '#64748b', fontSize: '14px', margin: '0 0 16px' }
const quote = { backgroundColor: '#f1f5f9', padding: '16px 20px', borderRadius: '12px', margin: '0 0 24px' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', padding: '12px 20px', borderRadius: '8px', fontSize: '15px' }
const small = { color: '#94a3b8', fontSize: '12px', lineHeight: '1.5', marginTop: '24px' }

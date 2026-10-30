import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { adminMessageSubject, type AdminMessageData } from '../adminMessageEmail.ts'

// A message or decision an administrator sent to this one person in the portal (also in their notifications).
// All text arrives as React props (escaped); links are pages on our own site only (_shared/adminMessageEmail.ts).

const COPY = {
  en: {
    preview: 'A message from the AI Support 360 team',
    heading: 'A message from the AI Support 360 team',
    digest: (n: number) => `You have ${n} new messages from the team`,
    open: 'Open',
    cta: 'Reply in the portal',
    prefs: 'Notification settings',
    why: 'You receive this because an AI Support 360 administrator sent you this message in the portal. You can also read it in your notifications.',
  },
  ar: {
    preview: 'رسالة من فريق AI Support 360',
    heading: 'رسالة من فريق AI Support 360',
    digest: (n: number) => `لديك ${n} رسائل جديدة من الفريق`,
    open: 'فتح',
    cta: 'الرد عبر البوابة',
    prefs: 'إعدادات الإشعارات',
    why: 'تصلك هذه الرسالة لأن أحد مسؤولي AI Support 360 أرسلها إليك في البوابة. يمكنك أيضًا قراءتها في إشعاراتك.',
  },
}

const AdminMessageEmail = ({ lang = 'en', digest = false, items = [], url = 'https://www.aisupport360.com/notifications', prefsUrl = 'https://www.aisupport360.com/notifications/pause' }: Partial<AdminMessageData>) => {
  const ar = lang === 'ar'
  const c = COPY[ar ? 'ar' : 'en']
  const dir = ar ? 'rtl' : 'ltr'
  const align = ar ? 'right' : 'left'
  return (
    <Html lang={ar ? 'ar' : 'en'} dir={dir}>
      <Head />
      <Preview>{digest ? c.digest(items.length) : (items[0]?.title || c.preview)}</Preview>
      <Body style={main}>
        <Container style={{ ...container, direction: dir, textAlign: align }}>
          <Text style={brand}>AI Support 360</Text>
          <Heading style={heading}>{digest ? c.digest(items.length) : c.heading}</Heading>
          {items.map((it, i) => (
            <Section key={i} style={card}>
              <Text style={itemTitle}>{it.title}</Text>
              {it.body ? <Text style={{ ...text, whiteSpace: 'pre-wrap' }}>{it.body}</Text> : null}
              {digest ? <Link href={it.url} style={smallLink}>{c.open}</Link> : null}
            </Section>
          ))}
          <Button href={url} style={button}>{c.cta}</Button>
          <Text style={small}>{c.why}</Text>
          <Link href={prefsUrl} style={smallLink}>{c.prefs}</Link>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AdminMessageEmail,
  subject: (data: Record<string, any>) => adminMessageSubject({ lang: data.lang === 'ar' ? 'ar' : 'en', digest: !!data.digest, items: data.items ?? [] }),
  displayName: 'Message from an administrator',
  previewData: {
    lang: 'en', digest: false,
    items: [{ title: 'Please add your SAP S/4HANA project dates', body: 'Hi, before we can verify your profile please add start and end dates to your two most recent projects.', url: 'https://www.aisupport360.com/consultant/profile' }],
    url: 'https://www.aisupport360.com/consultant/profile', prefsUrl: 'https://www.aisupport360.com/notifications/pause',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const brand = { color: '#1B2559', fontSize: '14px', fontWeight: 'bold' }
const heading = { color: '#1B2559', fontSize: '22px', margin: '20px 0 16px' }
const card = { backgroundColor: '#f1f5f9', padding: '16px 20px', borderRadius: '16px', margin: '0 0 12px' }
const itemTitle = { color: '#1B2559', fontSize: '16px', fontWeight: 'bold', margin: '0 0 6px' }
const text = { color: '#334155', fontSize: '15px', lineHeight: '1.6', margin: '0' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', padding: '12px 20px', borderRadius: '10px', fontSize: '15px', marginTop: '12px' }
const small = { color: '#94a3b8', fontSize: '12px', lineHeight: '1.5', marginTop: '24px' }
const smallLink = { color: '#3B82F6', fontSize: '12px' }

import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

/** Feature Y: the consultant's hold has ended (automatically at the end date, early, or by an administrator). */
interface Props {
  name?: string
  lang?: 'en' | 'ar'
  url?: string
}

const STR = {
  en: {
    subject: 'Welcome back - your hold has ended',
    preview: 'You can receive new requests again.',
    heading: 'Welcome back',
    hello: (n?: string) => `Hello ${n || 'there'},`,
    body: 'your "On hold" period has ended and your previous status is back. You can receive new requests, invitations and critical alerts again.',
    check: 'Please check that your weekly availability is still right.',
    button: 'Check my availability',
  },
  ar: {
    subject: 'مرحبًا بعودتك - انتهى التوقف المؤقت',
    preview: 'يمكنك استقبال الطلبات الجديدة مرة أخرى.',
    heading: 'مرحبًا بعودتك',
    hello: (n?: string) => `مرحبًا ${n || ''}،`,
    body: 'انتهت فترة "التوقف المؤقت" وعادت حالتك السابقة. يمكنك استقبال الطلبات والدعوات والتنبيهات العاجلة الجديدة مرة أخرى.',
    check: 'يرجى التأكد من أن توفرك الأسبوعي ما زال صحيحًا.',
    button: 'راجع توفري',
  },
} as const

const HoldEndedEmail = ({ name, lang = 'en', url = 'https://www.aisupport360.com/consultant/profile#availability' }: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>{t.hello(name)} {t.body}</Text>
          <Text style={text}>{t.check}</Text>
          <Button href={url} style={button}>{t.button}</Button>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: HoldEndedEmail,
  subject: (d: Record<string, any>) => STR[d.lang === 'ar' ? 'ar' : 'en'].subject,
  displayName: 'Hold ended (welcome back)',
  previewData: { name: 'Sara', lang: 'en' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 22px', fontSize: '15px', textDecoration: 'none', display: 'inline-block' }

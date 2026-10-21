import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { PauseFooter } from './pause-footer.tsx'
import type { PauseLinks } from '../notificationPause.ts'

/** Feature Y: "Please add your weekly availability" (the one-time urgent notice, or an administrator reminder). */
interface Props {
  pauseLinks?: PauseLinks
  name?: string
  lang?: 'en' | 'ar'
  /** ISO date: after it, consultants without weekly availability are not offered new requests or critical alerts. */
  deadline?: string
  url?: string
}

export const AVAILABILITY_URGENT_SUBJECT = {
  en: 'Please add your weekly availability - needed for requests',
  ar: 'يرجى إضافة توفرك الأسبوعي - مطلوب لاستقبال الطلبات',
} as const

const STR = {
  en: {
    preview: 'Clients and matching rely on your weekly availability.',
    heading: 'Please add your weekly availability',
    hello: (n?: string) => `Hello ${n || 'there'},`,
    intro: 'your profile has no weekly availability yet. It takes about a minute: pick your working days and hours.',
    why: 'Why it matters',
    w1: 'Clients and our matching rely on it to offer you requests at the right times.',
    w2: 'Requests that arrive outside your availability are not counted against you.',
    w3: (d?: string) => d
      ? `After ${d}, consultants without weekly availability are not offered new requests or critical alerts. Your sign-in and your current work are never affected.`
      : 'After the grace period, consultants without weekly availability are not offered new requests or critical alerts. Your sign-in and your current work are never affected.',
    button: 'Add my availability',
    away: 'Going away for a while? Use "On hold" in the same place, with start and end dates.',
  },
  ar: {
    preview: 'يعتمد العملاء والمطابقة على توفرك الأسبوعي.',
    heading: 'يرجى إضافة توفرك الأسبوعي',
    hello: (n?: string) => `مرحبًا ${n || ''}،`,
    intro: 'لا يحتوي ملفك على توفر أسبوعي بعد. يستغرق ذلك دقيقة تقريبًا: اختر أيام وساعات عملك.',
    why: 'لماذا يهم',
    w1: 'يعتمد عليه العملاء ونظام المطابقة لعرض الطلبات عليك في الأوقات المناسبة.',
    w2: 'الطلبات التي تصل خارج أوقات توفرك لا تُحتسب ضدك.',
    w3: (d?: string) => d
      ? `بعد ${d} لن تُعرض طلبات جديدة أو تنبيهات عاجلة على المستشارين الذين لم يضيفوا توفرهم الأسبوعي. لا يتأثر تسجيل دخولك ولا عملك الحالي.`
      : 'بعد انتهاء المهلة لن تُعرض طلبات جديدة أو تنبيهات عاجلة على المستشارين الذين لم يضيفوا توفرهم الأسبوعي. لا يتأثر تسجيل دخولك ولا عملك الحالي.',
    button: 'أضف توفري',
    away: 'ستغيب لفترة؟ استخدم "توقف مؤقت" في المكان نفسه مع تاريخي البداية والنهاية.',
  },
} as const

export function formatAvailabilityDeadline(iso: string | undefined, lang: 'en' | 'ar'): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(d)
}

const AvailabilityUrgentEmail = ({ name, lang = 'en', deadline, url = 'https://www.aisupport360.com/consultant/profile#availability', pauseLinks }: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const d = formatAvailabilityDeadline(deadline, l)
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={urgent}>{l === 'ar' ? 'عاجل' : 'Urgent'}</Text>
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>{t.hello(name)} {t.intro}</Text>
          <Section style={box}>
            <Text style={boxTitle}>{t.why}</Text>
            <Text style={item}>• {t.w1}</Text>
            <Text style={item}>• {t.w2}</Text>
            <Text style={item}>• {t.w3(d)}</Text>
          </Section>
          <Button href={url} style={button}>{t.button}</Button>
          <Text style={small}>{t.away}</Text>
          <PauseFooter links={pauseLinks} lang={l} />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AvailabilityUrgentEmail,
  subject: (d: Record<string, any>) => (d.lang === 'ar' ? AVAILABILITY_URGENT_SUBJECT.ar : AVAILABILITY_URGENT_SUBJECT.en),
  displayName: 'Weekly availability needed (urgent)',
  previewData: { name: 'Sara', lang: 'en', deadline: '2026-10-28T21:00:00Z' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const urgent = { display: 'inline-block', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 'bold', margin: '0 0 12px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 20px' }
const boxTitle = { fontSize: '14px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 8px' }
const item = { fontSize: '14px', color: '#1B2559', margin: '4px 0', lineHeight: '1.5' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '14px 26px', fontSize: '16px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#64748b', margin: '20px 0 0', lineHeight: '1.5' }

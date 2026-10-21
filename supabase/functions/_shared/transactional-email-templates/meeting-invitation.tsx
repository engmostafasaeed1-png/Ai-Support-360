import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

/** Bug H5: meeting invitation for an external (non-portal) attendee, with join page and calendar links. */
interface Props {
  lang?: 'en' | 'ar'
  title?: string
  organizer?: string
  startsAt?: string
  durationMinutes?: number
  joinUrl?: string
  icsUrl?: string
  googleUrl?: string
}

const STR = {
  en: {
    subject: (t: string) => `Meeting invitation: ${t}`,
    preview: 'You are invited to an online meeting on AI Support 360.',
    heading: 'You are invited to a meeting',
    intro: (o: string) => `${o} invited you to an online meeting on AI Support 360. You do not need an account to join.`,
    when: 'When', length: 'Length', minutes: (n: number) => `${n} minutes`,
    join: 'Join the meeting', calendar: 'Add to calendar:', ics: 'Calendar file (.ics)', google: 'Google Calendar',
    tz: 'Times are shown in Riyadh time (UTC+3); the calendar file uses your own time zone.',
    footer: 'You received this one-time invitation because someone entered your address when scheduling this meeting.',
  },
  ar: {
    subject: (t: string) => `دعوة اجتماع: ${t}`,
    preview: 'أنت مدعو إلى اجتماع عبر الإنترنت على AI Support 360.',
    heading: 'أنت مدعو إلى اجتماع',
    intro: (o: string) => `دعاك ${o} إلى اجتماع عبر الإنترنت على AI Support 360. لا تحتاج إلى حساب للانضمام.`,
    when: 'الموعد', length: 'المدة', minutes: (n: number) => `${n} دقيقة`,
    join: 'انضم إلى الاجتماع', calendar: 'أضف إلى التقويم:', ics: 'ملف التقويم (.ics)', google: 'تقويم Google',
    tz: 'الأوقات بتوقيت الرياض (UTC+3)، ويستخدم ملف التقويم منطقتك الزمنية.',
    footer: 'وصلتك هذه الدعوة لمرة واحدة لأن أحدهم أدخل عنوانك عند جدولة هذا الاجتماع.',
  },
} as const

export function formatMeetingWhen(iso: string | undefined, lang: 'en' | 'ar'): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-ca-gregory' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
  }).format(d)
}

const MeetingInvitationEmail = ({ lang = 'en', title = 'Meeting', organizer = 'AI Support 360', startsAt, durationMinutes = 60, joinUrl = 'https://www.aisupport360.com', icsUrl, googleUrl }: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>{t.intro(organizer)}</Text>
          <Section style={box}>
            <Text style={titleStyle}>{title}</Text>
            <Text style={item}><strong>{t.when}:</strong> {formatMeetingWhen(startsAt, l)}</Text>
            <Text style={item}><strong>{t.length}:</strong> {t.minutes(durationMinutes)}</Text>
          </Section>
          <Button href={joinUrl} style={button}>{t.join}</Button>
          <Text style={small}>{joinUrl}</Text>
          {(icsUrl || googleUrl) && (
            <Text style={item}>
              {t.calendar}{' '}
              {icsUrl && <Link href={icsUrl} style={link}>{t.ics}</Link>}
              {icsUrl && googleUrl && ' · '}
              {googleUrl && <Link href={googleUrl} style={link}>{t.google}</Link>}
            </Text>
          )}
          <Text style={small}>{t.tz}</Text>
          <Text style={small}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: MeetingInvitationEmail,
  subject: (d: Record<string, any>) => STR[d.lang === 'ar' ? 'ar' : 'en'].subject(String(d.title || 'AI Support 360').slice(0, 120)),
  displayName: 'Meeting invitation (external attendee)',
  previewData: { lang: 'en', title: 'SAP FI posting issue', organizer: 'Mostafa', startsAt: '2026-11-02T08:00:00Z', durationMinutes: 60, joinUrl: 'https://www.aisupport360.com/join/123', icsUrl: 'https://example.com/meeting.ics', googleUrl: 'https://calendar.google.com' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 20px' }
const titleStyle = { fontSize: '16px', fontWeight: 'bold', color: '#1B2559', margin: '0 0 8px' }
const item = { fontSize: '14px', color: '#1B2559', margin: '4px 0', lineHeight: '1.5' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '13px 24px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const link = { color: '#3B82F6', textDecoration: 'underline' }
const small = { fontSize: '12px', color: '#64748b', margin: '12px 0 0', lineHeight: '1.5', wordBreak: 'break-all' as const }

import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { durationLabel, policyText, readPolicyMinutes } from '../assignmentPolicy.ts'

/** New assignment request (step "request") and its reminders (r1, r2, r3). One template, EN/AR by the consultant's language. */
interface Props {
  lang?: 'en' | 'ar'
  step?: 'request' | 'r1' | 'r2' | 'r3'
  ticketTitle?: string
  sapArea?: string
  urgency?: string
  critical?: boolean
  bid?: boolean
  proposedRate?: number
  currency?: string
  /** ISO deadline. */
  deadline?: string
  minutesLeft?: number
  timezone?: string
  requestUrl?: string
  /** "Open ticket description" link (decision preview). */
  previewUrl?: string
  /** The three options (Accept / Decline / Request more information) are live. */
  infoOptions?: boolean
  /** Current admin timings (assignment_policy_minutes); defaults when missing. */
  policy?: Record<string, number>
}

const STR = {
  en: {
    newTitle: 'New assignment request',
    reminderTitle: (n: number) => `Reminder ${n}: assignment request waiting for your answer`,
    lastTitle: 'Last reminder: assignment request waiting for your answer',
    intro: 'A client would like you to work on this request. Please accept or decline in the portal.',
    bidIntro: 'A client invited you to bid on this request. Please answer before the bid deadline.',
    ticket: 'Request', area: 'SAP area', urgency: 'Urgency', rate: 'Proposed rate', deadline: 'Reply by',
    left: (d: string) => `Time left: ${d}`,
    timeUp: 'The response time ends now.',
    critical: 'Critical request',
    button: 'Accept or decline',
    policyTitle: 'Response policy',
    privacy: 'Client contact details stay inside the portal until you are assigned. Accepting still needs the NDA and an approved rate before work starts.',
    hour: '/ hour',
    optionsIntro: 'A client would like you to work on this request. Read the ticket description first if you like, then choose in the portal:',
    options: ['Accept', 'Decline (a reason is optional)', 'Request more information - the reply clock pauses until the client answers'],
    openRequest: 'Open request',
    preview: 'Open ticket description',
    previewNote: 'The preview shows the description and the list of attachments. Files, access details and contact details unlock after the NDA, an approved rate and the assignment.',
  },
  ar: {
    newTitle: 'طلب تعيين جديد',
    reminderTitle: (n: number) => `تذكير ${n}: طلب تعيين بانتظار ردك`,
    lastTitle: 'آخر تذكير: طلب تعيين بانتظار ردك',
    intro: 'يرغب أحد العملاء في أن تعمل على هذا الطلب. يرجى القبول أو الرفض في البوابة.',
    bidIntro: 'دعاك أحد العملاء لتقديم عرض على هذا الطلب. يرجى الرد قبل موعد إغلاق العروض.',
    ticket: 'الطلب', area: 'مجال SAP', urgency: 'الأولوية', rate: 'السعر المقترح', deadline: 'الرد قبل',
    left: (d: string) => `الوقت المتبقي: ${d}`,
    timeUp: 'ينتهي وقت الرد الآن.',
    critical: 'طلب حرج',
    button: 'اقبل أو ارفض',
    policyTitle: 'سياسة الرد',
    privacy: 'تبقى بيانات تواصل العميل داخل البوابة حتى يتم تعيينك. القبول يتطلب أيضاً اتفاقية السرية وسعراً معتمداً قبل بدء العمل.',
    hour: '/ ساعة',
    optionsIntro: 'يرغب أحد العملاء في أن تعمل على هذا الطلب. يمكنك قراءة وصف التذكرة أولاً، ثم اختر في البوابة:',
    options: ['القبول', 'الرفض (ذكر السبب اختياري)', 'طلب معلومات إضافية - يتوقف عدّاد الرد حتى يجيب العميل'],
    openRequest: 'افتح الطلب',
    preview: 'افتح وصف التذكرة',
    previewNote: 'تعرض المعاينة الوصف وقائمة المرفقات. أما الملفات وبيانات الوصول وبيانات التواصل فتُتاح بعد اتفاقية السرية والسعر المعتمد والتعيين.',
  },
} as const

function formatDeadline(iso: string | undefined, lang: 'en' | 'ar', tz: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return `${d.toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })} (${tz})`
  } catch {
    return `${d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })} (Asia/Riyadh)`
  }
}

const AssignmentRequestEmail = ({
  lang = 'en', step = 'request', ticketTitle, sapArea, urgency, critical = false, bid = false,
  proposedRate, currency, deadline, minutesLeft, timezone = 'Asia/Riyadh',
  requestUrl = 'https://www.aisupport360.com/consultant/requests', previewUrl, infoOptions = false, policy,
}: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const n = step === 'request' ? 0 : Number(step.slice(1))
  const title = n === 0 ? t.newTitle : n === 3 ? t.lastTitle : t.reminderTitle(n)
  const when = formatDeadline(deadline, l, timezone)
  const rows: Array<[string, string]> = [
    [t.ticket, ticketTitle || '—'],
    [t.area, sapArea || 'SAP'],
    [t.urgency, critical ? `${urgency || 'critical'} · ${t.critical}` : urgency || 'medium'],
  ]
  if (proposedRate != null && Number(proposedRate) > 0) rows.push([t.rate, `${Number(proposedRate)} ${currency || 'USD'} ${t.hour}`])
  if (when) rows.push([t.deadline, when])
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{`${title}: ${ticketTitle || ''}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          {critical && <Text style={criticalChip}>⚡ {t.critical}</Text>}
          <Heading style={h1}>{title}</Heading>
          <Text style={text}>{bid ? t.bidIntro : infoOptions ? t.optionsIntro : t.intro}</Text>
          {infoOptions && (
            <Section style={{ margin: '0 0 16px' }}>
              {t.options.map((o) => <Text key={o} style={row}>• {o}</Text>)}
            </Section>
          )}
          <Section style={box}>
            {rows.map(([k, v]) => (
              <Text key={k} style={row}><strong>{k}:</strong> {v}</Text>
            ))}
          </Section>
          {minutesLeft != null && (
            <Text style={leftStyle}>{minutesLeft > 0 ? t.left(durationLabel(minutesLeft, l, false)) : t.timeUp}</Text>
          )}
          <Button href={requestUrl} style={button}>{infoOptions ? t.openRequest : t.button}</Button>
          {infoOptions && previewUrl && (
            <>
              <Text style={{ margin: '12px 0 4px' }}>
                <a href={previewUrl} style={link}>{t.preview}</a>
              </Text>
              <Text style={small}>{t.previewNote}</Text>
            </>
          )}
          <Hr style={hr} />
          <Text style={boxTitle}>{t.policyTitle}</Text>
          <Text style={small}>{policyText(readPolicyMinutes(policy), l, { info: infoOptions })}</Text>
          <Text style={small}>{t.privacy}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AssignmentRequestEmail,
  subject: (d: Record<string, any>) => {
    const ar = d.lang === 'ar'
    const n = !d.step || d.step === 'request' ? 0 : Number(String(d.step).slice(1))
    const title = String(d.ticketTitle || '').slice(0, 80)
    const crit = d.critical ? (ar ? '[حرج] ' : '[Critical] ') : ''
    if (n === 0) return `${crit}${ar ? 'طلب تعيين جديد' : 'New assignment request'}: ${title}`
    return `${crit}${ar ? `تذكير ${n}` : `Reminder ${n}`}: ${title}`
  },
  displayName: 'Assignment request and reminders',
  previewData: {
    lang: 'en', step: 'r1', ticketTitle: 'FB50 posting error after S/4HANA migration', sapArea: 'SAP FI', urgency: 'high',
    critical: false, proposedRate: 60, currency: 'USD', deadline: '2026-10-21T08:00:00Z', minutesLeft: 1320,
    infoOptions: true, previewUrl: 'https://www.aisupport360.com/consultant/requests?preview=1',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 16px' }
const row = { fontSize: '14px', color: '#1B2559', margin: '4px 0', lineHeight: '1.5' }
const leftStyle = { fontSize: '14px', fontWeight: 'bold', color: '#b45309', margin: '0 0 16px' }
const criticalChip = { display: 'inline-block', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 'bold', margin: '0 0 12px' }
const button = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '13px 24px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const link = { color: '#1B2559', fontSize: '14px', fontWeight: 'bold', textDecoration: 'underline' }
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const boxTitle = { fontSize: '14px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 8px' }
const small = { fontSize: '13px', color: '#475569', margin: '0 0 10px', lineHeight: '1.5' }

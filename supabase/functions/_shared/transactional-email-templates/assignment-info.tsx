import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { PauseFooter } from './pause-footer.tsx'
import type { PauseLinks } from '../notificationPause.ts'
import { INFO_TOPICS } from '../assignmentInfo.ts'

/**
 * Feature L addition, "Request more information":
 * - ask: to the client, the consultant's question;
 * - answer: to the consultant, the client answered (the reply clock runs again);
 * - timeout: to the client, the question is still waiting for an answer.
 * The question already passed the contact-bypass filter; the client's answer is not repeated in the e-mail.
 */
interface Props {
  /** Feature Q signed pause links, filled in by sendTemplateEmail for non-essential sends. */
  pauseLinks?: PauseLinks
  lang?: 'en' | 'ar'
  kind?: 'ask' | 'answer' | 'timeout'
  ticketTitle?: string
  consultantName?: string
  topics?: string[]
  question?: string
  clientDueAt?: string
  responseDueAt?: string
  timezone?: string
  url?: string
}

const TOPICS: Record<'en' | 'ar', Record<string, string>> = {
  en: { scope: 'Scope', system: 'System version / landscape', error: 'Error message / screenshot', timeline_budget: 'Timeline / budget', access: 'Access method' },
  ar: { scope: 'نطاق العمل', system: 'إصدار النظام وبيئته', error: 'رسالة الخطأ أو لقطة شاشة', timeline_budget: 'الجدول الزمني أو الميزانية', access: 'طريقة الوصول' },
}

const STR = {
  en: {
    askTitle: (n: string) => `${n} asks for more information`,
    askIntro: (n: string, t: string) => `${n} is considering your request "${t}" and needs a little more information before deciding.`,
    topics: 'About', question: 'Question',
    answerBy: (d: string) => `Please answer by ${d} on the ticket card. Until then the consultant's reply time is paused.`,
    askButton: 'Answer on the ticket',
    answerTitle: 'The client answered your question',
    answerIntro: (t: string) => `The client answered your question about "${t}". You can now accept, decline or ask once more.`,
    replyBy: (d: string) => `Your reply time runs again: please answer by ${d}.`,
    answerButton: 'Open request',
    timeoutTitle: 'Waiting for your answer',
    timeoutIntro: (n: string, t: string) => `${n} is still waiting for your answer about "${t}". The request stays paused until you answer.`,
    timeoutButton: 'Answer now',
    privacy: 'Please do not share e-mail addresses, phone numbers or links here: contact details are shared inside the portal once a consultant is assigned.',
  },
  ar: {
    askTitle: (n: string) => `${n} يطلب معلومات إضافية`,
    askIntro: (n: string, t: string) => `يدرس ${n} طلبك "${t}" ويحتاج إلى بعض المعلومات الإضافية قبل أن يقرر.`,
    topics: 'بخصوص', question: 'السؤال',
    answerBy: (d: string) => `يرجى الإجابة قبل ${d} في بطاقة التذكرة. وحتى ذلك الحين يتوقف وقت رد الاستشاري.`,
    askButton: 'أجب في التذكرة',
    answerTitle: 'أجاب العميل عن سؤالك',
    answerIntro: (t: string) => `أجاب العميل عن سؤالك بشأن "${t}". يمكنك الآن القبول أو الرفض أو السؤال مرة أخرى.`,
    replyBy: (d: string) => `عاد عدّاد الرد للعمل: يرجى الرد قبل ${d}.`,
    answerButton: 'افتح الطلب',
    timeoutTitle: 'بانتظار إجابتك',
    timeoutIntro: (n: string, t: string) => `ما زال ${n} ينتظر إجابتك بشأن "${t}". يبقى الطلب متوقفاً حتى تجيب.`,
    timeoutButton: 'أجب الآن',
    privacy: 'يرجى عدم مشاركة عناوين البريد أو أرقام الهواتف أو الروابط هنا: تُشارك بيانات التواصل داخل البوابة بعد تعيين الاستشاري.',
  },
} as const

function formatWhen(iso: string | undefined, lang: 'en' | 'ar', tz: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return `${d.toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })} (${tz})`
  } catch {
    return `${d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })} (Asia/Riyadh)`
  }
}

export function topicLabels(topics: readonly string[] | undefined, lang: 'en' | 'ar'): string[] {
  return (topics ?? []).filter((x) => (INFO_TOPICS as readonly string[]).includes(x)).map((x) => TOPICS[lang][x])
}

const AssignmentInfoEmail = ({
  lang = 'en', kind = 'ask', ticketTitle, consultantName, topics, question, clientDueAt, responseDueAt,
  timezone = 'Asia/Riyadh', url = 'https://www.aisupport360.com', pauseLinks,
}: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const name = consultantName || (l === 'ar' ? 'الاستشاري' : 'The consultant')
  const title = ticketTitle || (l === 'ar' ? 'طلبك' : 'your request')
  const labels = topicLabels(topics, l)
  const heading = kind === 'answer' ? t.answerTitle : kind === 'timeout' ? t.timeoutTitle : t.askTitle(name)
  const clientWhen = formatWhen(clientDueAt, l, 'Asia/Riyadh')
  const replyWhen = formatWhen(responseDueAt, l, timezone)
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          {kind === 'answer' ? (
            <>
              <Text style={text}>{t.answerIntro(title)}</Text>
              {replyWhen && <Text style={strong}>{t.replyBy(replyWhen)}</Text>}
              <Button href={url} style={button}>{t.answerButton}</Button>
            </>
          ) : (
            <>
              <Text style={text}>{kind === 'timeout' ? t.timeoutIntro(name, title) : t.askIntro(name, title)}</Text>
              {(labels.length > 0 || question) && (
                <Section style={box}>
                  {labels.length > 0 && <Text style={row}><strong>{t.topics}:</strong> {labels.join(', ')}</Text>}
                  {question && <Text style={row}><strong>{t.question}:</strong> {question}</Text>}
                </Section>
              )}
              {kind === 'ask' && clientWhen && <Text style={strong}>{t.answerBy(clientWhen)}</Text>}
              <Button href={url} style={button}>{kind === 'timeout' ? t.timeoutButton : t.askButton}</Button>
              <Text style={small}>{t.privacy}</Text>
            </>
          )}
          <PauseFooter links={pauseLinks} lang={lang} />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AssignmentInfoEmail,
  subject: (d: Record<string, any>) => {
    const ar = d.lang === 'ar'
    const title = String(d.ticketTitle || '').slice(0, 80)
    if (d.kind === 'answer') return `${ar ? 'أجاب العميل عن سؤالك' : 'The client answered your question'}: ${title}`
    if (d.kind === 'timeout') return `${ar ? 'بانتظار إجابتك' : 'Waiting for your answer'}: ${title}`
    return `${ar ? 'سؤال من الاستشاري' : 'A consultant asks for more information'}: ${title}`
  },
  displayName: 'Assignment request: more information',
  previewData: {
    lang: 'en', kind: 'ask', ticketTitle: 'FB50 posting error after S/4HANA migration', consultantName: 'Karim',
    topics: ['scope', 'error'], question: 'Which company codes are affected, and could you share the full error text?',
    clientDueAt: '2026-10-21T20:00:00Z',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const strong = { fontSize: '14px', fontWeight: 'bold', color: '#b45309', margin: '0 0 16px' }
const box = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 16px' }
const row = { fontSize: '14px', color: '#1B2559', margin: '4px 0', lineHeight: '1.5' }
const button = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '13px 24px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#475569', margin: '16px 0 0', lineHeight: '1.5' }

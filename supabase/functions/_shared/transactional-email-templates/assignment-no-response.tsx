import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

/** Sent to the client when a consultant did not answer an assignment request in time. */
interface Props {
  lang?: 'en' | 'ar'
  consultantName?: string
  ticketTitle?: string
  canExtend?: boolean
  inviteUrl?: string
  bidsUrl?: string
  waitUrl?: string
}

const STR = {
  en: {
    title: (n: string) => `${n} did not respond within the time limit`,
    body: (t: string) => `Your request "${t}" did not get an answer in time. You can invite another consultant from the next best matches, open the request for bids, or give the consultant 24 more hours (once).`,
    noExtend: (t: string) => `Your request "${t}" did not get an answer in time. You can invite another consultant from the next best matches or open the request for bids.`,
    invite: 'Invite another consultant',
    bids: 'Open for bids',
    wait: 'Wait 24 hours longer',
    note: 'The next best matches are shown when you choose "Invite another consultant".',
    fallbackName: 'The consultant',
    fallbackTitle: 'your request',
  },
  ar: {
    title: (n: string) => `${n} لم يرد خلال المهلة`,
    body: (t: string) => `لم يصل رد على طلبك "${t}" في الوقت المحدد. يمكنك دعوة استشاري آخر من أفضل التطابقات التالية، أو فتح الطلب للعروض، أو منح الاستشاري 24 ساعة إضافية (مرة واحدة).`,
    noExtend: (t: string) => `لم يصل رد على طلبك "${t}" في الوقت المحدد. يمكنك دعوة استشاري آخر من أفضل التطابقات التالية أو فتح الطلب للعروض.`,
    invite: 'ادعُ استشارياً آخر',
    bids: 'افتح الطلب للعروض',
    wait: 'انتظر 24 ساعة إضافية',
    note: 'تظهر أفضل التطابقات التالية عند اختيار "ادعُ استشارياً آخر".',
    fallbackName: 'الاستشاري',
    fallbackTitle: 'طلبك',
  },
} as const

const AssignmentNoResponseEmail = ({
  lang = 'en', consultantName, ticketTitle, canExtend = true,
  inviteUrl = 'https://www.aisupport360.com/client/tickets', bidsUrl = 'https://www.aisupport360.com/client/tickets', waitUrl = 'https://www.aisupport360.com/client/tickets',
}: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const name = consultantName || t.fallbackName
  const title = ticketTitle || t.fallbackTitle
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.title(name)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.title(name)}</Heading>
          <Text style={text}>{canExtend ? t.body(title) : t.noExtend(title)}</Text>
          <Section style={{ margin: '0 0 12px' }}>
            <Button href={inviteUrl} style={primary}>{t.invite}</Button>
          </Section>
          <Section style={{ margin: '0 0 12px' }}>
            <Button href={bidsUrl} style={secondary}>{t.bids}</Button>
          </Section>
          {canExtend && (
            <Section style={{ margin: '0 0 12px' }}>
              <Button href={waitUrl} style={secondary}>{t.wait}</Button>
            </Section>
          )}
          <Text style={small}>{t.note}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AssignmentNoResponseEmail,
  subject: (d: Record<string, any>) => {
    const ar = d.lang === 'ar'
    const name = String(d.consultantName || (ar ? 'الاستشاري' : 'The consultant')).slice(0, 60)
    return ar ? `${name} لم يرد خلال المهلة` : `${name} did not respond within the time limit`
  },
  displayName: 'Assignment request: no response (client)',
  previewData: { lang: 'en', consultantName: 'Sara A.', ticketTitle: 'FB50 posting error after S/4HANA migration', canExtend: true },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 20px' }
const primary = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 22px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const secondary = { backgroundColor: '#f1f5f9', color: '#1B2559', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '11px 22px', fontSize: '14px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#64748b', margin: '16px 0 0', lineHeight: '1.5' }

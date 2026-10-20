import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

/** Feature M: a request reached "No response" (counted / not counted / warning N of M / badge) or a dispute was reviewed. */
interface Props {
  lang?: 'en' | 'ar'
  kind?: string
  ticketTitle?: string
  count30?: number
  warningsTotal?: number
  disputeDays?: number
  pageUrl?: string
}

const STR = {
  en: {
    warningTitle: (k: number, n: number) => `Warning ${k} of ${n}: no response`,
    warningBody: (t: string, k: number, n: number) => `You did not answer "${t}" in time and it counts against your response rate. Warning ${k} of ${n}: repeated non-response will show a Response badge on your card and affect your ranking.`,
    badgeTitle: 'Responsiveness: Needs improvement',
    badgeBody: (t: string, c: number) => `You did not answer "${t}" in time. This is no-response number ${c} in 30 days, so your Responsiveness indicator can show "Needs improvement" on your card and affects your ranking. It recovers automatically as you answer new requests in time.`,
    countedTitle: 'No response counted',
    countedBody: (t: string, c: number) => `You did not answer "${t}" in time. It counts against your response rate (${c} in the last 30 days).`,
    notCountedTitle: 'No response, not counted',
    notCountedBody: (t: string) => `You did not answer "${t}" in time, but it arrived outside your availability, so it is not counted in your response rate.`,
    upheldTitle: 'Dispute accepted',
    upheldBody: (t: string) => `The no-response on "${t}" was removed from your statistics.`,
    rejectedTitle: 'Dispute not accepted',
    rejectedBody: (t: string) => `The no-response on "${t}" still counts.`,
    dispute: (d: number) => `If it was not your fault (for example a technical failure, or the request came outside your stated hours), you can dispute it within ${d} days on your My responsiveness page.`,
    improve: 'How to keep a good responsiveness: accept or decline every request within the time limit (a decline counts as a response), keep your availability up to date and mark vacations in advance.',
    button: 'Open My responsiveness',
    fallbackTitle: 'a request',
  },
  ar: {
    warningTitle: (k: number, n: number) => `تحذير ${k} من ${n}: لا يوجد رد`,
    warningBody: (t: string, k: number, n: number) => `لم ترد على "${t}" في الوقت المحدد، ويُحتسب ذلك ضمن نسبة ردك. تحذير ${k} من ${n}: تكرار عدم الرد سيُظهر شارة "الاستجابة" على بطاقتك ويؤثر على ترتيبك.`,
    badgeTitle: 'مؤشر الاستجابة: يحتاج إلى تحسين',
    badgeBody: (t: string, c: number) => `لم ترد على "${t}" في الوقت المحدد. هذه المرة رقم ${c} خلال 30 يوماً، لذا يمكن أن يظهر مؤشر الاستجابة على بطاقتك بمستوى "يحتاج إلى تحسين" ويؤثر على ترتيبك. يتحسن تلقائياً عندما ترد على الطلبات الجديدة في الوقت.`,
    countedTitle: 'عدم رد محتسب',
    countedBody: (t: string, c: number) => `لم ترد على "${t}" في الوقت المحدد، ويُحتسب ذلك ضمن نسبة ردك (${c} خلال آخر 30 يوماً).`,
    notCountedTitle: 'لا يوجد رد، غير محتسب',
    notCountedBody: (t: string) => `لم ترد على "${t}" في الوقت المحدد، لكنه وصل خارج أوقات توفرك، لذلك لا يُحتسب في نسبة ردك.`,
    upheldTitle: 'تم قبول اعتراضك',
    upheldBody: (t: string) => `أُزيل عدم الرد على "${t}" من إحصاءاتك.`,
    rejectedTitle: 'لم يُقبل اعتراضك',
    rejectedBody: (t: string) => `لا يزال عدم الرد على "${t}" محتسباً.`,
    dispute: (d: number) => `إذا لم يكن ذلك بسببك (مثل عطل تقني، أو وصول الطلب خارج ساعاتك المعلنة)، يمكنك الاعتراض خلال ${d} أيام من صفحة "استجابتي".`,
    improve: 'للحفاظ على استجابة جيدة: اقبل أو ارفض كل طلب خلال المهلة (الرفض يُحتسب رداً)، وحدّث أوقات توفرك، وسجّل إجازاتك مسبقاً.',
    button: 'افتح صفحة استجابتي',
    fallbackTitle: 'طلب',
  },
} as const

export function noticeCopy(d: Props): { title: string; body: string; showDispute: boolean } {
  const l = d.lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const title = (d.ticketTitle || t.fallbackTitle).slice(0, 120)
  const n = Math.max(1, Number(d.warningsTotal) || 2)
  const c = Math.max(1, Number(d.count30) || 1)
  const kind = String(d.kind || 'counted')
  const m = /^warning_(\d)$/.exec(kind)
  if (m) return { title: t.warningTitle(Number(m[1]), n), body: t.warningBody(title, Number(m[1]), n), showDispute: true }
  switch (kind) {
    case 'badge_visible': return { title: t.badgeTitle, body: t.badgeBody(title, c), showDispute: true }
    case 'not_counted': return { title: t.notCountedTitle, body: t.notCountedBody(title), showDispute: false }
    case 'dispute_upheld': return { title: t.upheldTitle, body: t.upheldBody(title), showDispute: false }
    case 'dispute_rejected': return { title: t.rejectedTitle, body: t.rejectedBody(title), showDispute: false }
    default: return { title: t.countedTitle, body: t.countedBody(title, c), showDispute: true }
  }
}

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

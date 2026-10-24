import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { PauseFooter } from './pause-footer.tsx'
import type { PauseLinks } from '../notificationPause.ts'

/**
 * "BRD v3 was attached to <ticket>": to an assigned consultant who may read it (NDA rule checked in the database
 * when the notice is claimed), only when the client ticked "Notify the consultant". Activity category (pausable).
 * The e-mail carries no document content, only the version number and the ticket title.
 */
interface Props {
  pauseLinks?: PauseLinks
  lang?: 'en' | 'ar'
  version?: number
  ticketTitle?: string
  url?: string
}

const STR = {
  en: {
    title: (v: number) => `BRD v${v} was attached`,
    intro: (v: number, t: string) => `The client attached version ${v} of the Business Requirements Document to "${t}".`,
    body: 'You can read it, download the PDF and add comments or suggested changes on the case page.',
    button: 'Open the BRD',
    privacy: 'The document is confidential and shared under the NDA of this ticket.',
  },
  ar: {
    title: (v: number) => `أُرفق الإصدار ${v} من وثيقة المتطلبات`,
    intro: (v: number, t: string) => `أرفق العميل الإصدار ${v} من وثيقة متطلبات الأعمال بالتذكرة "${t}".`,
    body: 'يمكنك قراءتها وتنزيل ملف PDF وإضافة تعليقات أو اقتراح تغييرات من صفحة الحالة.',
    button: 'افتح الوثيقة',
    privacy: 'الوثيقة سرية ومشاركة بموجب اتفاقية عدم الإفصاح الخاصة بهذه التذكرة.',
  },
} as const

const BrdAttachedEmail = ({ lang = 'en', version = 1, ticketTitle, url = 'https://www.aisupport360.com', pauseLinks }: Props) => {
  const l = lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const v = Number.isInteger(version) && version > 0 ? version : 1
  const title = ticketTitle || (l === 'ar' ? 'التذكرة' : 'the ticket')
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.title(v)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.title(v)}</Heading>
          <Text style={text}>{t.intro(v, title)}</Text>
          <Text style={text}>{t.body}</Text>
          <Button href={url} style={button}>{t.button}</Button>
          <Text style={small}>{t.privacy}</Text>
          <PauseFooter links={pauseLinks} lang={lang} />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BrdAttachedEmail,
  subject: (d: Record<string, any>) => {
    const v = Number(d.version) || 1
    const title = String(d.ticketTitle || '').slice(0, 80)
    return d.lang === 'ar' ? `أُرفق الإصدار ${v} من وثيقة المتطلبات: ${title}` : `BRD v${v} was attached to ${title}`
  },
  displayName: 'BRD attached to a ticket',
  previewData: { lang: 'en', version: 3, ticketTitle: 'MIRO invoices blocked after upgrade', url: 'https://www.aisupport360.com/consultant/cases/example/brd' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const button = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '13px 24px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#475569', margin: '16px 0 0', lineHeight: '1.5' }

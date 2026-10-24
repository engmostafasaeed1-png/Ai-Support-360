import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { PauseFooter } from './pause-footer.tsx'
import type { PauseLinks } from '../notificationPause.ts'

/**
 * Ticket tracking notices (docs/sql/ticket-tracking.sql): the other party changed the working status, the consultant
 * marked their part complete (asks the client to confirm), the expected date is tomorrow / has passed, or the work has
 * waited for the client's review for N days. One recipient per e-mail, queued by the database for a specific event
 * (status e-mails throttled to one per person and ticket per window). Names are never shown ("the consultant").
 */
type Kind = 'status' | 'completed' | 'due_tomorrow' | 'overdue' | 'review'
interface Props {
  pauseLinks?: PauseLinks
  lang?: 'en' | 'ar'
  kind?: Kind
  ticketTitle?: string
  statusLabel?: string
  actor?: 'client' | 'consultant' | 'admin'
  note?: string
  expectedDate?: string
  days?: number
  url?: string
}

const WHO = {
  en: { client: 'the client', consultant: 'the consultant', admin: 'the support team' },
  ar: { client: 'العميل', consultant: 'الاستشاري', admin: 'فريق الدعم' },
} as const

const STR = {
  en: {
    head: { status: 'Working status updated', completed: 'Please confirm the resolution', due_tomorrow: 'Expected date is tomorrow', overdue: 'Expected date has passed', review: 'Work is waiting for your review' },
    status: (t: string, s: string, w: string) => `"${t}" is now "${s}" (set by ${w}).`,
    completed: (t: string) => `The consultant marked their part of "${t}" as complete. Please check the work and confirm the resolution, or choose "Needs rework". The ticket has not been closed.`,
    due: (t: string, s: string, d: string) => `"${t}" (${s}) is expected by ${d}.`,
    overdue: (t: string, s: string, d: string) => `"${t}" (${s}) was expected by ${d}. Please update the working status or the expected date.`,
    review: (t: string, n: number) => `"${t}" has been ready for your review for ${n} days or more.`,
    note: 'Note',
    button: 'Open the ticket',
    footer: 'You receive this because you work on this ticket on AI Support 360. The latest status is always on the ticket page.',
  },
  ar: {
    head: { status: 'تم تحديث حالة العمل', completed: 'يرجى تأكيد الحل', due_tomorrow: 'الموعد المتوقع غداً', overdue: 'تجاوز الموعد المتوقع', review: 'العمل بانتظار مراجعتك' },
    status: (t: string, s: string, w: string) => `أصبحت حالة «${t}» الآن «${s}» (بواسطة ${w}).`,
    completed: (t: string) => `أشار الاستشاري إلى أن جزءه من «${t}» مكتمل. يرجى مراجعة العمل وتأكيد الحل، أو اختيار «يحتاج إلى إعادة عمل». لم يتم إغلاق التذكرة.`,
    due: (t: string, s: string, d: string) => `الموعد المتوقع لـ «${t}» (${s}) هو ${d}.`,
    overdue: (t: string, s: string, d: string) => `كان الموعد المتوقع لـ «${t}» (${s}) هو ${d}. يرجى تحديث حالة العمل أو الموعد المتوقع.`,
    review: (t: string, n: number) => `«${t}» جاهز لمراجعتك منذ ${n} أيام أو أكثر.`,
    note: 'ملاحظة',
    button: 'افتح التذكرة',
    footer: 'تصلك هذه الرسالة لأنك تعمل على هذه التذكرة في AI Support 360. تجد دائماً أحدث حالة في صفحة التذكرة.',
  },
} as const

function lines(p: Props) {
  const l = p.lang === 'ar' ? 'ar' : 'en'
  const t = STR[l]
  const kind: Kind = p.kind ?? 'status'
  const title = (p.ticketTitle || (l === 'ar' ? 'التذكرة' : 'the ticket')).slice(0, 120)
  const label = (p.statusLabel || '').slice(0, 80)
  const date = (p.expectedDate || '').slice(0, 10)
  const who = WHO[l][p.actor ?? 'consultant'] ?? WHO[l].consultant
  const body = kind === 'completed' ? t.completed(title)
    : kind === 'due_tomorrow' ? t.due(title, label, date)
    : kind === 'overdue' ? t.overdue(title, label, date)
    : kind === 'review' ? t.review(title, Number(p.days) > 0 ? Number(p.days) : 3)
    : t.status(title, label, who)
  return { l, t, kind, title, body }
}

const TicketTrackingEmail = (p: Props) => {
  const { l, t, kind, body } = lines(p)
  const note = kind === 'status' && p.note ? String(p.note).slice(0, 300) : ''
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.head[kind]}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.head[kind]}</Heading>
          <Text style={text}>{body}</Text>
          {note && (
            <Section style={noteBox}>
              <Text style={noteLabel}>{t.note}</Text>
              <Text style={noteText}>{note}</Text>
            </Section>
          )}
          <Button href={p.url || 'https://www.aisupport360.com'} style={button}>{t.button}</Button>
          <Text style={small}>{t.footer}</Text>
          <PauseFooter links={p.pauseLinks} lang={l} />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: TicketTrackingEmail,
  subject: (d: Record<string, any>) => {
    const { t, kind, title } = lines(d as Props)
    return `${t.head[kind]}: ${title.slice(0, 80)}`
  },
  displayName: 'Ticket working status and reminders',
  previewData: { lang: 'en', kind: 'status', ticketTitle: 'MIRO invoices blocked after upgrade', statusLabel: 'Waiting for client information', actor: 'consultant', note: 'Please send a screenshot of the tolerance key settings.', url: 'https://www.aisupport360.com/client/tickets/example' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#1B2559', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const noteBox = { backgroundColor: '#F1F5F9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 18px' }
const noteLabel = { fontSize: '12px', color: '#64748B', fontWeight: 'bold', margin: '0 0 4px', textTransform: 'uppercase' as const }
const noteText = { fontSize: '14px', color: '#0F172A', lineHeight: '1.5', margin: '0' }
const button = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '13px 24px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#475569', margin: '16px 0 0', lineHeight: '1.5' }

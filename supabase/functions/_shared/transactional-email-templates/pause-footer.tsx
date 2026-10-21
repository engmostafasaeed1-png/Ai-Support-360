import * as React from 'npm:react@18.3.1'
import { Hr, Link, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { PauseLinks } from '../notificationPause.ts'

/**
 * Feature Q footer for every non-essential notification e-mail. sendTemplateEmail fills `pauseLinks` with signed one-click
 * links (no sign-in needed). Unsubscribe comes from the managed footer the e-mail platform adds, never from here; without them (essential e-mails, feature off) nothing is rendered.
 */
const STR = {
  en: { lead: 'Too many e-mails? Pause for:', d3: '3 days', w1: '1 week', m1: '1 month' },
  ar: { lead: 'رسائل كثيرة؟ أوقفها مؤقتاً لمدة:', d3: '3 أيام', w1: 'أسبوع', m1: 'شهر' },
} as const

export function PauseFooter({ links, lang = 'en' }: { links?: PauseLinks | null; lang?: string }) {
  if (!links) return null
  const t = STR[lang === 'ar' ? 'ar' : 'en']
  const sep = <span style={divider}> | </span>
  return (
    <Section style={wrap} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Hr style={hr} />
      <Text style={text}>
        {t.lead}{' '}
        <Link href={links.d3} style={link}>{t.d3}</Link>{sep}
        <Link href={links.w1} style={link}>{t.w1}</Link>{sep}
        <Link href={links.m1} style={link}>{t.m1}</Link>
      </Text>
    </Section>
  )
}

const wrap = { margin: '24px 0 0' }
const hr = { borderColor: '#e2e8f0', margin: '0 0 12px' }
const text = { fontSize: '12px', color: '#64748b', lineHeight: '1.6', margin: '0' }
const link = { color: '#1B2559', textDecoration: 'underline' }
const divider = { color: '#94a3b8' }

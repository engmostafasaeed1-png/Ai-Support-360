import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  name?: string
  percent?: number
  missing?: string[]
  interviewDone?: boolean
  payoutReady?: boolean
  lang?: 'en' | 'ar'
  profileUrl?: string
  interviewUrl?: string
}

const STR = {
  en: {
    preview: (p: number) => `Your AI Support 360 profile is ${p} % complete`,
    heading: 'Finish your profile to start receiving work',
    hello: (n?: string) => `Hello ${n || 'there'},`,
    intro: (p: number) => `your consultant profile is ${p} % complete. A complete profile with an AI interview badge is what clients see first.`,
    missingTitle: 'Next steps',
    completeBtn: 'Complete my profile',
    interviewBtn: 'Take the AI interview',
    why: 'Why it matters',
    b1: 'Complete profiles appear higher in the directory and are invited to bids first.',
    b2: 'The AI interview badge (Gold 85+, Silver 70+, Bronze 50+, Verified) proves tested skills and builds client trust.',
    b3: 'Verified, complete profiles are easier for clients to choose.',
    b4: 'Payouts need your payout details.',
    footer: 'You receive this reminder because your profile is not complete yet. It stops automatically once your profile is complete and the AI interview is done.',
  },
  ar: {
    preview: (p: number) => `ملفك في AI Support 360 مكتمل بنسبة ${p}٪`,
    heading: 'أكمل ملفك لتبدأ باستقبال العمل',
    hello: (n?: string) => `مرحباً ${n || ''}،`,
    intro: (p: number) => `ملفك كاستشاري مكتمل بنسبة ${p}٪. الملف المكتمل مع شارة مقابلة الذكاء الاصطناعي هو ما يراه العملاء أولاً.`,
    missingTitle: 'الخطوات التالية',
    completeBtn: 'أكمل ملفي',
    interviewBtn: 'ابدأ مقابلة الذكاء الاصطناعي',
    why: 'لماذا يهم',
    b1: 'الملفات المكتملة تظهر أعلى في الدليل وتُدعى للعروض أولاً.',
    b2: 'شارة مقابلة الذكاء الاصطناعي (ذهبي 85+، فضي 70+، برونزي 50+، موثّق) تثبت مهارات مختبرة وتبني ثقة العملاء.',
    b3: 'الملفات الموثقة والمكتملة أسهل على العملاء في الاختيار.',
    b4: 'المدفوعات تحتاج بيانات الدفع الخاصة بك.',
    footer: 'تصلك هذه التذكرة لأن ملفك غير مكتمل بعد. تتوقف تلقائياً عند اكتمال الملف وإتمام مقابلة الذكاء الاصطناعي.',
  },
} as const

const ProfileReminderEmail = ({
  name,
  percent = 0,
  missing = [],
  interviewDone = false,
  payoutReady = true,
  lang = 'en',
  profileUrl = 'https://www.aisupport360.com/consultant/profile?section=setup',
  interviewUrl = 'https://www.aisupport360.com/consultant/interviews?start=1',
}: Props) => {
  const t = STR[lang === 'ar' ? 'ar' : 'en']
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <Html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{t.preview(p)}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>{t.hello(name)} {t.intro(p)}</Text>
          <Section style={barWrap}>
            <Section style={{ ...barFill, width: `${p}%` }} />
          </Section>
          <Text style={pct}>{p} %</Text>
          {missing.length > 0 && (
            <Section style={box}>
              <Text style={boxTitle}>{t.missingTitle}</Text>
              {missing.slice(0, 5).map((m, i) => (
                <Text key={i} style={itemText}>• {m}</Text>
              ))}
            </Section>
          )}
          <Button href={profileUrl} style={button}>{t.completeBtn}</Button>
          {!interviewDone && (
            <>
              {' '}
              <Button href={interviewUrl} style={buttonAlt}>{t.interviewBtn}</Button>
            </>
          )}
          <Hr style={hr} />
          <Text style={boxTitle}>{t.why}</Text>
          <Text style={itemText}>• {t.b1}</Text>
          <Text style={itemText}>• {t.b2}</Text>
          <Text style={itemText}>• {t.b3}</Text>
          {!payoutReady && <Text style={itemText}>• {t.b4}</Text>}
          <Text style={small}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ProfileReminderEmail,
  subject: (d: Record<string, any>) =>
    d.lang === 'ar'
      ? `ملفك في AI Support 360 مكتمل بنسبة ${Math.round(d.percent ?? 0)}٪`
      : `Your AI Support 360 profile is ${Math.round(d.percent ?? 0)} % complete`,
  displayName: 'Consultant profile reminder',
  previewData: { name: 'Sara', percent: 60, missing: ['Industries', 'Language levels'], interviewDone: false, payoutReady: false },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const barWrap = { backgroundColor: '#e2e8f0', borderRadius: '999px', height: '10px', overflow: 'hidden', margin: '0 0 6px' }
const barFill = { backgroundColor: '#1B2559', height: '10px', borderRadius: '999px' }
const pct = { fontSize: '13px', fontWeight: 'bold', color: '#1B2559', margin: '0 0 16px' }
const box = { backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '12px 16px', margin: '0 0 20px' }
const boxTitle = { fontSize: '14px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 8px' }
const itemText = { fontSize: '14px', color: '#1B2559', margin: '4px 0', lineHeight: '1.5' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 20px', fontSize: '15px', textDecoration: 'none' }
const buttonAlt = { backgroundColor: '#ffffff', color: '#1B2559', border: '1px solid #1B2559', borderRadius: '12px', padding: '12px 20px', fontSize: '15px', textDecoration: 'none' }
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const small = { fontSize: '12px', color: '#64748b', margin: '24px 0 0', lineHeight: '1.5' }

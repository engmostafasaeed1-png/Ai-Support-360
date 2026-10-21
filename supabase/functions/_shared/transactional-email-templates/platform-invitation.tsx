import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  name?: string
  role?: 'consultant' | 'client'
  message?: string
  url?: string
  language?: 'en' | 'ar'
}

/**
 * What each side can actually do once the account exists. Kept as a
 * factual capability list (no marketing claims) so the invitation stays
 * a transactional email about account setup.
 */
const CLIENT_CAPABILITIES = [
  'Describe SAP support requirements and review AI suggestions and relevant knowledge articles.',
  'Find consultants based on expertise, experience, language, availability, and rates.',
  'Review proposals and agree on rates and estimated effort.',
  'Schedule consultations using the available communication options.',
  'Review work records, approve timesheets, and track invoices.',
  'Manage NDAs and access to case information.',
]

const CONSULTANT_CAPABILITIES = [
  'Create a professional profile with skills, certifications, experience, and project history.',
  'Set availability and proposed hourly rates.',
  'Receive relevant support invitations and accept or decline them.',
  'Submit proposals with estimated effort and delivery timelines.',
  'Record work, submit timesheets, and communicate with clients.',
  'View recorded earnings, platform fees, and payout status.',
]

const CLIENT_CAPABILITIES_AR = [
  'وصف احتياجات دعم SAP ومراجعة اقتراحات الذكاء الاصطناعي ومقالات المعرفة ذات الصلة.',
  'العثور على استشاريين حسب الخبرة واللغة والتوفر والأسعار.',
  'مراجعة العروض والاتفاق على الأسعار والجهد المتوقع.',
  'جدولة الاستشارات باستخدام وسائل التواصل المتاحة.',
  'مراجعة سجلات العمل واعتماد سجلات الساعات ومتابعة الفواتير.',
  'إدارة اتفاقيات عدم الإفصاح والوصول إلى معلومات الحالة.',
]

const CONSULTANT_CAPABILITIES_AR = [
  'إنشاء ملف مهني يضم المهارات والشهادات والخبرات والمشاريع.',
  'تحديد أوقات التوفر وأسعار الساعة المقترحة.',
  'استلام دعوات الدعم المناسبة وقبولها أو الاعتذار عنها.',
  'تقديم العروض مع الجهد المتوقع ومواعيد التسليم.',
  'تسجيل العمل وإرسال سجلات الساعات والتواصل مع العملاء.',
  'عرض الأرباح المسجلة ورسوم المنصة وحالة الدفعات.',
]

const COPY = {
  en: {
    previewC: 'Your consultant account invitation — AI Support 360', previewK: 'Your client account invitation — AI Support 360',
    labelC: 'CONSULTANT INVITATION', labelK: 'CLIENT INVITATION',
    hi: (n?: string) => n ? `Hi ${n}, you're invited` : "You're invited",
    introC: 'Create your consultant account to complete your professional profile and manage assignments, availability, timesheets, and invoices.',
    introK: 'Create your client account to submit support requests and manage your tickets, approvals, and invoices.',
    listC: 'IN YOUR CONSULTANT ACCOUNT YOU CAN', listK: 'IN YOUR CLIENT ACCOUNT YOU CAN',
    buttonC: 'Create my consultant account', buttonK: 'Create my client account',
    fallback: 'Or open this link:', footer: "If you weren't expecting this invitation, you can ignore this email.",
  },
  ar: {
    previewC: 'دعوة لحساب استشاري — AI Support 360', previewK: 'دعوة لحساب عميل — AI Support 360',
    labelC: 'دعوة استشاري', labelK: 'دعوة عميل',
    hi: (n?: string) => n ? `مرحباً ${n}، أنت مدعو` : 'أنت مدعو',
    introC: 'أنشئ حسابك كاستشاري لإكمال ملفك المهني وإدارة المهام والتوفر وسجلات الساعات والفواتير.',
    introK: 'أنشئ حسابك كعميل لإرسال طلبات الدعم وإدارة التذاكر والموافقات والفواتير.',
    listC: 'في حسابك كاستشاري يمكنك', listK: 'في حسابك كعميل يمكنك',
    buttonC: 'إنشاء حسابي كاستشاري', buttonK: 'إنشاء حسابي كعميل',
    fallback: 'أو افتح هذا الرابط:', footer: 'إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.',
  },
}

const Email = ({ name, role = 'client', message, url = 'https://www.aisupport360.com/signup', language = 'en' }: Props) => {
  const isConsultant = role === 'consultant'
  const ar = language === 'ar'
  const c = ar ? COPY.ar : COPY.en
  const capabilities = ar
    ? (isConsultant ? CONSULTANT_CAPABILITIES_AR : CLIENT_CAPABILITIES_AR)
    : (isConsultant ? CONSULTANT_CAPABILITIES : CLIENT_CAPABILITIES)
  return (
    <Html lang={ar ? 'ar' : 'en'} dir={ar ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{isConsultant ? c.previewC : c.previewK}</Preview>
      <Body style={{ ...main, ...(ar ? { fontFamily: "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif", textAlign: 'right' as const } : {}) }}>
        <Container style={container}>
          <Section style={brandBar}><Text style={brandText}>AI Support 360</Text></Section>
          <Text style={accountLabel}>{isConsultant ? c.labelC : c.labelK}</Text>
          <Heading style={h1}>{c.hi(name)}</Heading>
          <Text style={text}>
            {isConsultant ? c.introC : c.introK}
          </Text>
          <Text style={sectionLabel}>
            {isConsultant ? c.listC : c.listK}
          </Text>
          <Section style={listBox}>
            {capabilities.map((line, i) => (
              <Text key={i} style={ar ? listItemRtl : listItem}>
                <span style={bullet}>{'•'}</span> {line}
              </Text>
            ))}
          </Section>
          {message ? <Text style={ar ? quoteRtl : quote}>“{message}”</Text> : null}
          <Section style={buttonWrap}>
            <Button style={button} href={url}>{isConsultant ? c.buttonC : c.buttonK}</Button>
          </Section>
          <Text style={fallback}>{c.fallback} {url}</Text>
          <Text style={footer}>{c.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => {
    const c = d.language === 'ar' ? COPY.ar : COPY.en
    return d.role === 'consultant' ? c.previewC : c.previewK
  },
  displayName: 'Platform invitation',
  previewData: { name: 'Sara', role: 'consultant', message: 'We would love to have you on board.' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { backgroundColor: '#1B2559', borderRadius: '16px', padding: '16px 20px', marginBottom: '28px' }
const brandText = { color: '#ffffff', fontSize: '16px', fontWeight: 'bold' as const, margin: 0 }
const accountLabel = { color: '#475569', fontSize: '12px', fontWeight: 'bold' as const, margin: '0 0 12px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1B2559', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 16px' }
const sectionLabel = { color: '#1B2559', fontSize: '11px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: '0 0 10px' }
const listBox = { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px 18px', margin: '0 0 20px' }
const listItem = { fontSize: '14px', color: '#334155', lineHeight: '1.55', margin: '0 0 8px', padding: '0 0 0 18px', textIndent: '-18px' }
const bullet = { color: '#3B82F6', fontWeight: 'bold' as const, paddingRight: '8px' }
const quote = { fontSize: '14px', color: '#1B2559', fontStyle: 'italic' as const, borderLeft: '3px solid #3B82F6', paddingLeft: '12px', margin: '0 0 16px' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '14px', padding: '14px 28px', textDecoration: 'none' }
const fallback = { fontSize: '12px', color: '#94a3b8', wordBreak: 'break-all' as const }
const listItemRtl = { ...listItem, padding: '0 18px 0 0' }
const quoteRtl = { ...quote, borderLeft: 'none', borderRight: '3px solid #3B82F6', paddingLeft: 0, paddingRight: '12px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }

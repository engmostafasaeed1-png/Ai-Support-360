import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { renderReferralEmail, sampleReferralEmail } from '../referralEmail.ts'

/**
 * Feature Z: one short, honest referral notice to one consultant (the event that concerns them). Names are the masked
 * public format (Feature X) only. EN/AR by the recipient's language.
 */
type Kind = 'signup' | 'invited' | 'passed_self' | 'passed_other' | 'active' | 'reminder' | 'expired' | 'ack_request' | 'verified' | 'first_reward' | 'payout_details_changed'

interface Props {
  kind?: Kind
  lang?: 'en' | 'ar'
  name?: string
  other?: string
  nextStep?: string
  passMark?: number
  days?: number
  amount?: string
  currency?: string
  url?: string
}

const NEXT = {
  en: {
    pass_interview: (p: number) => `Pass the AI interview (score at least ${p}).`,
    acknowledge: () => 'Accept the referral terms on the Refer & earn page.',
    wait_other: (_p: number, o: string) => `Waiting for ${o} to pass the AI interview and accept the terms.`,
    none: () => '',
  },
  ar: {
    pass_interview: (p: number) => `اجتز المقابلة الذكية (بدرجة ${p} على الأقل).`,
    acknowledge: () => 'وافق على شروط الإحالة في صفحة "أحِل واربح".',
    wait_other: (_p: number, o: string) => `بانتظار أن يجتاز ${o} المقابلة الذكية ويوافق على الشروط.`,
    none: () => '',
  },
} as const

const STR = {
  en: {
    hello: (n?: string) => `Hello ${n || 'there'},`,
    button: 'Open Refer & earn',
    k: {
      signup: { s: 'Someone registered with your referral code', b: (o: string) => `${o} registered with your code. Your referral becomes active when you both pass the AI interview.` },
      invited: { s: 'You were invited to AI Support 360', b: (o: string) => `You were invited by ${o}. The referral programme becomes active after you and your referrer pass the AI interview.` },
      passed_self: { s: 'You passed the AI interview', b: () => 'You passed the AI interview. Next for your referral:' },
      passed_other: { s: 'Your referral partner passed the AI interview', b: (o: string) => `${o} passed the AI interview. Next for your referral:` },
      active: { s: 'Your referral is active', b: (o: string) => `Your referral with ${o} is now active. Rewards count for work invoiced from today.` },
      reminder: { s: 'Your referral is still pending', b: (o: string) => `Your referral with ${o} is still pending. Next step:` },
      expired: { s: 'Your referral has expired', b: (o: string, d?: number) => `Your referral with ${o} has expired: both of you had to pass the AI interview and accept the terms within ${d ?? 90} days. An administrator can revive it.` },
      ack_request: { s: 'Please accept the referral terms', b: (o: string) => `Please accept the referral terms so your referral with ${o} can become active.` },
      verified: { s: 'Your referral is verified', b: (o: string) => `${o} is now a verified consultant. Your reward starts with their first paid ticket after your referral is active.` },
      first_reward: { s: 'You earned your first referral reward', b: (o: string, _d?: number, a?: string) => `You earned ${a ?? ''} from the work of ${o}. It becomes available after the hold period that follows their payout. It is paid by AI Support 360, never deducted from them.` },
      payout_details_changed: { s: 'Your bank details were changed', b: (_o: string, d?: number) => `Your payout bank details were just changed. If this was not you, contact support immediately. For your safety, referral payouts wait ${d ?? 7} days after a change.` },
    },
  },
  ar: {
    hello: (n?: string) => `مرحبًا ${n || ''}،`,
    button: 'افتح أحِل واربح',
    k: {
      signup: { s: 'سجّل شخص باستخدام رمز الإحالة الخاص بك', b: (o: string) => `سجّل ${o} باستخدام رمزك. تصبح الإحالة نشطة عندما تجتازان كلاكما المقابلة الذكية.` },
      invited: { s: 'تمت دعوتك إلى AI Support 360', b: (o: string) => `دعاك ${o}. يصبح برنامج الإحالة نشطًا بعد أن تجتاز أنت ومن دعاك المقابلة الذكية.` },
      passed_self: { s: 'لقد اجتزت المقابلة الذكية', b: () => 'لقد اجتزت المقابلة الذكية. الخطوة التالية لإحالتك:' },
      passed_other: { s: 'اجتاز شريك الإحالة المقابلة الذكية', b: (o: string) => `اجتاز ${o} المقابلة الذكية. الخطوة التالية لإحالتك:` },
      active: { s: 'إحالتك نشطة الآن', b: (o: string) => `أصبحت إحالتك مع ${o} نشطة الآن. تُحتسب المكافآت عن الأعمال المفوترة من اليوم.` },
      reminder: { s: 'إحالتك ما زالت قيد الانتظار', b: (o: string) => `إحالتك مع ${o} ما زالت قيد الانتظار. الخطوة التالية:` },
      expired: { s: 'انتهت صلاحية إحالتك', b: (o: string, d?: number) => `انتهت صلاحية إحالتك مع ${o}: كان على كليكما اجتياز المقابلة الذكية والموافقة على الشروط خلال ${d ?? 90} يومًا. يمكن للمسؤول إعادة تفعيلها.` },
      ack_request: { s: 'يرجى الموافقة على شروط الإحالة', b: (o: string) => `يرجى الموافقة على شروط الإحالة حتى تصبح إحالتك مع ${o} نشطة.` },
      verified: { s: 'تم توثيق المستشار الذي أحلته', b: (o: string) => `أصبح ${o} مستشارًا موثّقًا. تبدأ مكافأتك مع أول تذكرة مدفوعة له بعد تفعيل الإحالة.` },
      first_reward: { s: 'حصلت على أول مكافأة إحالة', b: (o: string, _d?: number, a?: string) => `حصلت على ${a ?? ''} من عمل ${o}. تصبح متاحة بعد فترة الانتظار التي تلي دفعته. تدفعها AI Support 360 ولا تُخصم منه أبدًا.` },
      payout_details_changed: { s: 'تم تغيير بياناتك البنكية', b: (_o: string, d?: number) => `تم للتو تغيير بيانات الحساب البنكي لاستلام المدفوعات. إن لم تكن أنت، تواصل مع الدعم فورًا. حفاظًا على أمانك، تنتظر مدفوعات الإحالة ${d ?? 7} أيام بعد أي تغيير.` },
    },
  },
} as const

export function referralNoticeText(p: Props): { subject: string; body: string; next: string } {
  const l = p.lang === 'ar' ? 'ar' : 'en'
  const k = (p.kind && p.kind in STR[l].k ? p.kind : 'signup') as Kind
  const other = p.other || (l === 'ar' ? 'المستشار' : 'the consultant')
  const entry = STR[l].k[k]
  const body = entry.b(other, p.days, p.amount ? `${p.amount} ${p.currency ?? ''}`.trim() : undefined)
  const step = (p.nextStep && p.nextStep in NEXT[l] ? p.nextStep : 'none') as keyof typeof NEXT['en']
  const next = ['passed_self', 'passed_other', 'reminder'].includes(k) ? NEXT[l][step](p.passMark ?? 50, other) : ''
  return { subject: entry.s, body, next }
}

const ReferralNoticeEmail = (p: Props) => {
  const l = p.lang === 'ar' ? 'ar' : 'en'
  const { subject, body, next } = referralNoticeText(p)
  return (
    <Html lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{subject}</Heading>
          <Text style={text}>{STR[l].hello(p.name)}</Text>
          <Text style={text}>{body}{next ? ` ${next}` : ''}</Text>
          <Button href={p.url || 'https://www.aisupport360.com/consultant/referrals'} style={button}>{STR[l].button}</Button>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ReferralNoticeEmail,
  // The shared Refer & earn layout (_shared/referralEmail.ts) renders the HTML and the plain-text part in one piece;
  // the React component above stays only as a simple fallback.
  subject: (d: Record<string, any>) => renderReferralEmail(d as any).subject,
  html: (d: Record<string, any>) => renderReferralEmail(d as any).html,
  text: (d: Record<string, any>) => renderReferralEmail(d as any).text,
  displayName: 'Referral notice',
  previewData: { ...sampleReferralEmail('signup', 'en') },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const button = { backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 22px', fontSize: '15px', textDecoration: 'none', display: 'inline-block' }

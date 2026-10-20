import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { POLICY_NOTICE_STR, policyNoticeLang, type PolicyNoticeProps as Props } from '../consultantPolicyCopy.ts'

/** Feature N e-mail to one consultant: confirm the current Consultant Service Policy (first notice, reminder or admin reminder). */
const ConsultantPolicyNoticeEmail = (props: Props) => {
  const l = policyNoticeLang(props.lang)
  const t = POLICY_NOTICE_STR[l]
  const v = Math.max(1, Number(props.version) || 1)
  const confirmUrl = props.confirmUrl || 'https://www.aisupport360.com/consultant/profile#service-policy'
  const policyUrl = props.policyUrl || 'https://www.aisupport360.com/consultant-policy'
  const dir = l === 'ar' ? 'rtl' : 'ltr'
  return (
    <Html lang={l} dir={dir}>
      <Head />
      <Preview>{t.subject(props.kind)}</Preview>
      <Body style={main}>
        <Container style={{ ...container, direction: dir, textAlign: l === 'ar' ? 'right' : 'left' }}>
          <Heading style={h1}>{t.subject(props.kind)}</Heading>
          <Text style={text}>{t.hello(props.name)}</Text>
          <Text style={text}>{t.intro(v)}</Text>
          {props.summary && (
            <Section style={box}>
              <Text style={boxTitle}>{props.title ? `${props.title} · ` : ''}{t.summary}</Text>
              <Text style={boxText}>{props.summary}</Text>
            </Section>
          )}
          <Text style={text}>{props.deadline ? t.deadline(props.deadline) : t.noDeadline}</Text>
          <Section style={{ margin: '0 0 16px' }}>
            <Button href={confirmUrl} style={primary}>{t.button}</Button>
          </Section>
          <Text style={small}>{t.full} {policyUrl}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ConsultantPolicyNoticeEmail,
  subject: (d: Record<string, any>) => POLICY_NOTICE_STR[policyNoticeLang(d.lang)].subject(d.kind),
  displayName: 'Consultant Service Policy notice',
  previewData: { lang: 'en', kind: 'notice', name: 'Sara', version: 1, title: 'Consultant Service Policy', summary: 'Please accept or decline every assignment request within 24 hours (30 minutes for Critical requests).', deadline: '27 October 2026' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '14px', padding: '14px 16px', margin: '0 0 16px' }
const boxTitle = { fontSize: '14px', fontWeight: 'bold', color: '#1B2559', margin: '0 0 6px' }
const boxText = { fontSize: '14px', color: '#1e293b', lineHeight: '1.6', margin: '0' }
const primary = { background: 'linear-gradient(135deg, #1B2559, #3B82F6)', backgroundColor: '#1B2559', color: '#ffffff', borderRadius: '12px', padding: '12px 22px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none', display: 'inline-block' }
const small = { fontSize: '13px', color: '#64748b', margin: '16px 0 0', lineHeight: '1.5' }

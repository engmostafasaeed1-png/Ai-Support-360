import * as React from 'npm:react@18.3.1'
import { renderToStaticMarkup } from 'npm:react-dom@18.3.1/server'
import type { TemplateEntry } from './registry.ts'
import {
  buildPolicyEmail, policyEmailSubject, policyEmailText, renderPolicyEmailHtml, type PolicyEmailProps,
} from '../consultantPolicyEmail.ts'
import {
  POLICY_DRAFT_BODY_AR, POLICY_DRAFT_BODY_EN, POLICY_DRAFT_SUMMARY_AR, POLICY_DRAFT_SUMMARY_EN, POLICY_DRAFT_TITLE_AR, POLICY_DRAFT_TITLE_EN,
} from '../consultantPolicyDraft.ts'

/**
 * Feature N e-mail to one consultant: the FULL current Consultant Service Policy in BOTH languages (the consultant's
 * preferred language first, then the other), with the reasons behind it (first notice, reminder or admin reminder).
 * Layout lives in ../consultantPolicyEmail.ts (shared with the tests); React escapes every text from the database.
 */
const ConsultantPolicyNoticeEmail = (props: PolicyEmailProps) => buildPolicyEmail(React.createElement, props)

const preview = (lang: 'en' | 'ar'): PolicyEmailProps => ({
  lang,
  kind: 'notice',
  name: lang === 'ar' ? 'سارة' : 'Sara',
  version: 1,
  texts: {
    en: { title: POLICY_DRAFT_TITLE_EN, summary: POLICY_DRAFT_SUMMARY_EN, body: POLICY_DRAFT_BODY_EN, effectiveDate: '21 October 2026', deadline: '28 October 2026' },
    ar: { title: POLICY_DRAFT_TITLE_AR, summary: POLICY_DRAFT_SUMMARY_AR, body: POLICY_DRAFT_BODY_AR, effectiveDate: '21 أكتوبر 2026', deadline: '28 أكتوبر 2026' },
  },
})

export const template = {
  component: ConsultantPolicyNoticeEmail,
  subject: (d: Record<string, any>) => policyEmailSubject(d as PolicyEmailProps),
  // Rendered in one piece: the streaming renderer can split Arabic letters at chunk boundaries (shown as "��").
  html: (d: Record<string, any>) => renderPolicyEmailHtml(React.createElement, (el) => renderToStaticMarkup(el as React.ReactElement), d as PolicyEmailProps),
  text: (d: Record<string, any>) => policyEmailText(d as PolicyEmailProps),
  displayName: 'Consultant Service Policy notice',
  previewData: preview('en'),
} satisfies TemplateEntry

/** Preview only (Cloud -> Emails): the same e-mail as an Arabic-speaking consultant receives it (Arabic first). Never sent by name. */
export const arabicPreviewTemplate = {
  ...template,
  displayName: 'Consultant Service Policy notice (Arabic first preview)',
  previewData: preview('ar'),
} satisfies TemplateEntry

import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { POLICY_NOTICE_STR, policyNoticeLang } from '../consultantPolicyCopy.ts'
import { buildPolicyEmail, policyEmailText, type PolicyEmailProps } from '../consultantPolicyEmail.ts'
import {
  POLICY_DRAFT_BODY_AR, POLICY_DRAFT_BODY_EN, POLICY_DRAFT_SUMMARY_AR, POLICY_DRAFT_SUMMARY_EN, POLICY_DRAFT_TITLE_AR, POLICY_DRAFT_TITLE_EN,
} from '../consultantPolicyDraft.ts'

/**
 * Feature N e-mail to one consultant: the FULL current Consultant Service Policy with the reasons behind it
 * (first notice, reminder or admin reminder). Layout lives in ../consultantPolicyEmail.ts (shared with the tests);
 * React escapes every text from the database.
 */
const ConsultantPolicyNoticeEmail = (props: PolicyEmailProps) => buildPolicyEmail(React.createElement, props)

const subject = (d: Record<string, any>) => POLICY_NOTICE_STR[policyNoticeLang(d.lang)].subject(d.kind)

const preview = (lang: 'en' | 'ar'): PolicyEmailProps => ({
  lang,
  kind: 'notice',
  name: lang === 'ar' ? 'سارة' : 'Sara',
  version: 1,
  title: lang === 'ar' ? POLICY_DRAFT_TITLE_AR : POLICY_DRAFT_TITLE_EN,
  summary: lang === 'ar' ? POLICY_DRAFT_SUMMARY_AR : POLICY_DRAFT_SUMMARY_EN,
  body: lang === 'ar' ? POLICY_DRAFT_BODY_AR : POLICY_DRAFT_BODY_EN,
  effectiveDate: lang === 'ar' ? '21 أكتوبر 2026' : '21 October 2026',
  deadline: lang === 'ar' ? '28 أكتوبر 2026' : '28 October 2026',
})

export const template = {
  component: ConsultantPolicyNoticeEmail,
  subject,
  text: (d: Record<string, any>) => policyEmailText(d as PolicyEmailProps),
  displayName: 'Consultant Service Policy notice',
  previewData: preview('en'),
} satisfies TemplateEntry

/** Preview only (Cloud -> Emails): the same e-mail as an Arabic-speaking consultant receives it. Never sent by name. */
export const arabicPreviewTemplate = {
  ...template,
  displayName: 'Consultant Service Policy notice (Arabic preview)',
  previewData: preview('ar'),
} satisfies TemplateEntry

import * as React from 'npm:react@18.3.1'
import { renderToStaticMarkup } from 'npm:react-dom@18.3.1/server'
import type { TemplateEntry } from './registry.ts'
import { adminMessageSubject, adminMessageText, buildAdminMessageData, renderAdminMessage, type AdminMessageData } from '../adminMessageEmail.ts'

// A message or decision an administrator sent to this one person in the portal (also in their notifications).
// Layout lives only in _shared/adminMessageEmail.ts (createElement, so every text is escaped by React; tested in vitest).

const DEFAULTS: AdminMessageData = {
  lang: 'en', digest: false, items: [],
  url: 'https://www.aisupport360.com/notifications', inboxUrl: 'https://www.aisupport360.com/notifications',
  prefsUrl: 'https://www.aisupport360.com/notifications/pause', helpHref: 'mailto:info@aisupport360.com',
}
const data = (d: Record<string, any>): AdminMessageData => ({ ...DEFAULTS, ...d, lang: d.lang === 'ar' ? 'ar' : 'en', items: Array.isArray(d.items) ? d.items : [] })

const AdminMessageEmail = (props: Partial<AdminMessageData>) =>
  renderAdminMessage(React.createElement as any, data(props as Record<string, any>)) as React.ReactElement

export const template = {
  component: AdminMessageEmail,
  subject: (d: Record<string, any>) => adminMessageSubject(data(d)),
  html: (d: Record<string, any>) => '<!DOCTYPE html>' + renderToStaticMarkup(renderAdminMessage(React.createElement as any, data(d)) as React.ReactElement),
  text: (d: Record<string, any>) => adminMessageText(data(d)),
  displayName: 'Message from an administrator',
  previewData: buildAdminMessageData({
    mail_key: 'preview', recipient: '', email: '', lang: 'en', digest: false,
    items: [{ id: '1', type: 'admin_message', link: '/consultant/profile', created_at: '2026-10-30T12:40:00Z',
      title: 'Please add your SAP S/4HANA project dates',
      body: 'Hi Sara,\n\nBefore we can verify your profile, please:\n- add start and end dates to your two latest projects\n- upload your **SAP certificate**',
      meta: { v: 1, category: 'action', summary: 'Two quick changes and your profile can be verified.', action_label: 'Update your profile', deadline: '2026-11-06',
        context: { kind: 'other', label: 'Consultant profile', status: 'Under review' } } }],
  }, 'https://www.aisupport360.com'),
} satisfies TemplateEntry

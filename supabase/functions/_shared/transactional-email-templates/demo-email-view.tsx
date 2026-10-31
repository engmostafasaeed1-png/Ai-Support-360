import * as React from 'npm:react@18.3.1'
import { renderToStaticMarkup } from 'npm:react-dom@18.3.1/server'
import type { TemplateEntry } from './registry.ts'
import { demoEmailText, renderDemoEmail } from '../demoScheduleEmail.ts'
import type { DemoEmailView } from '../demoSchedule.ts'

// Shared entry for the demo-booking templates: templateData IS the DemoEmailView built by _shared/demoSchedule.ts
// (content decided there, layout in _shared/demoScheduleEmail.ts), rendered in one piece via the html/text hooks.
const view = (d: Record<string, any>): DemoEmailView => ({
  lang: d.lang === 'ar' ? 'ar' : 'en', subject: String(d.subject ?? 'AI Support 360'), preheader: String(d.preheader ?? ''),
  category: d.category ?? 'notice', badge: d.badge ?? null, title: String(d.title ?? ''), summary: String(d.summary ?? ''),
  paragraphs: Array.isArray(d.paragraphs) ? d.paragraphs.map(String) : [], rows: Array.isArray(d.rows) ? d.rows : [],
  quote: d.quote ?? null, slots: d.slots ?? null, todo: d.todo ?? null,
  primary: d.primary ?? { label: 'AI Support 360', href: 'https://www.aisupport360.com/' },
  secondary: Array.isArray(d.secondary) ? d.secondary : [], sentLine: String(d.sentLine ?? ''),
  footer: d.footer ?? { helpLine: 'Questions? Write to', help: 'info@aisupport360.com', why: '' }, test: !!d.test,
})

export function demoTemplate(displayName: string, previewData: DemoEmailView, to?: string): TemplateEntry {
  const Component = (props: Record<string, any>) => renderDemoEmail(React.createElement as any, view(props)) as React.ReactElement
  return {
    component: Component,
    subject: (d: Record<string, any>) => view(d).subject,
    html: (d: Record<string, any>) => '<!DOCTYPE html>' + renderToStaticMarkup(renderDemoEmail(React.createElement as any, view(d)) as React.ReactElement),
    text: (d: Record<string, any>) => demoEmailText(view(d)),
    displayName,
    previewData: previewData as unknown as Record<string, any>,
    ...(to ? { to } : {}),
  }
}

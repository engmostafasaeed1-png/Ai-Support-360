/**
 * Layout of the demo-booking e-mails (admin alert/reminder, requester received/confirmed/rescheduled/cancelled):
 * the shared admin-message frame (_shared/adminMessageEmail.ts renderEmailShell) with the parts of a DemoEmailView.
 * createElement only (every text is a React child, so escaped), table-based inline styles, no images besides the logo,
 * no tracking pixels. Tested in src/test/demoSchedule.test.tsx.
 */
import {
  EMAIL_STYLES as S, MESSAGE_COPY, emailButton, emailRow, emailTable, renderEmailShell, type EmailH,
} from './adminMessageEmail.ts';
import type { DemoEmailView } from './demoSchedule.ts';

const INK = '#1B2559';
const LINE = '#E6EAF2';

function outlineButton(h: EmailH, href: string, label: string, key: number) {
  return emailTable(h, { key, width: 'auto', style: { margin: '12px 0 0', width: 'auto' } },
    emailRow(h, { style: { border: `2px solid ${INK}`, borderRadius: '12px' } },
      h('a', { href, style: { display: 'inline-block', padding: '12px 24px', fontSize: '15px', lineHeight: '20px', fontWeight: 'bold', color: INK, textDecoration: 'none', fontFamily: 'Arial,Helvetica,sans-serif' } }, label)));
}

export function renderDemoEmail(h: EmailH, v: DemoEmailView) {
  const lang = v.lang === 'ar' ? 'ar' : 'en';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const c = MESSAGE_COPY[lang];
  const content = [
    h('p', { key: 'chip', style: { margin: 0 } },
      h('span', { style: S.chip(v.category) }, c.categories[v.category]),
      v.badge ? h('span', { style: S.badge(v.badge.tone, dir) }, v.badge.text) : null),
    h('h1', { key: 'h1', style: S.h1 }, v.title),
    v.summary ? h('p', { key: 'sum', style: S.summary }, v.summary) : null,
    h('div', { key: 'div', style: S.divider }, '\u00a0'),
    ...v.paragraphs.map((p, i) => h('p', { key: `p${i}`, style: S.p }, p)),
    v.todo ? h('div', { key: 'todo', style: v.todo.overdue ? { ...S.todo, backgroundColor: '#FEF2F2', border: '1px solid #FECACA' } : S.todo },
      h('p', { style: v.todo.overdue ? { ...S.todoH, color: '#991B1B' } : S.todoH }, v.todo.heading),
      ...v.todo.lines.map((l, i) => h('p', { key: i, style: { ...S.todoP, margin: i ? '6px 0 0' : '0' } }, l)),
      v.todo.strong ? h('p', { style: { ...S.todoP, marginTop: '8px', fontWeight: 'bold', color: v.todo.overdue ? '#991B1B' : '#451A03' } }, v.todo.strong) : null) : null,
    v.slots ? h('div', { key: 'slots', style: S.ctx },
      h('p', { style: S.ctxKind }, v.slots.heading),
      v.slots.empty ? h('p', { style: { ...S.ctxLabel, color: '#92400E' } }, v.slots.empty) : null,
      ...v.slots.items.map((s, i) => h('div', { key: i, style: { padding: '8px 0', borderTop: i ? `1px solid ${LINE}` : '0' } },
        h('p', { style: S.ctxLabel }, s.main, s.note ? h('span', { style: { fontWeight: 'normal', color: '#B45309' } }, ` · ${s.note}`) : null),
        s.sub ? h('p', { style: { ...S.ctxMeta, margin: '2px 0 0' } }, s.sub) : null))) : null,
    v.rows.length ? emailTable(h, { key: 'rows', style: { margin: '18px 0', borderTop: `1px solid ${LINE}` } },
      ...v.rows.map((r, i) => h('tr', { key: i },
        h('td', { width: '38%', valign: 'top', style: { padding: '9px 0', borderBottom: `1px solid ${LINE}`, fontSize: '13px', lineHeight: '19px', color: '#64748b', fontWeight: 'bold', [`padding${dir === 'rtl' ? 'Left' : 'Right'}`]: '12px' } }, r.label),
        h('td', { valign: 'top', style: { padding: '9px 0', borderBottom: `1px solid ${LINE}`, fontSize: '14px', lineHeight: '20px', color: '#0f172a', wordBreak: 'break-word' } }, r.value)))) : null,
    v.quote ? h('div', { key: 'quote', style: S.quote(dir) },
      h('p', { style: S.quoteH }, v.quote.label),
      h('p', { style: { ...S.p, margin: 0, color: '#1e293b' } }, ...v.quote.text.split('\n').flatMap((l, i) => (i ? [h('br', { key: `q${i}` }), l] : [l])))) : null,
    emailButton(h, v.primary.href, v.primary.label),
    ...v.secondary.map((s, i) => outlineButton(h, s.href, s.label, i)),
  ];
  return renderEmailShell(h, {
    lang, title: v.title, preheader: v.preheader, test: v.test, content, site: 'https://www.aisupport360.com', sentLine: v.sentLine,
    footer: { ...v.footer, helpHref: `mailto:${v.footer.help}` },
  });
}

/** Plain-text alternative: same content, same order. */
export function demoEmailText(v: DemoEmailView): string {
  const c = MESSAGE_COPY[v.lang === 'ar' ? 'ar' : 'en'];
  const parts = [
    `[${c.categories[v.category]}${v.badge ? ` · ${v.badge.text}` : ''}] ${v.title}`,
    v.summary,
    ...v.paragraphs,
    v.todo ? `${v.todo.heading}:\n${v.todo.lines.map((l) => `- ${l}`).join('\n')}${v.todo.strong ? `\n${v.todo.strong}` : ''}` : '',
    v.slots ? `${v.slots.heading}:\n${v.slots.empty ?? v.slots.items.map((s) => `- ${s.main}${s.note ? ` (${s.note})` : ''}${s.sub ? `\n  ${s.sub}` : ''}`).join('\n')}` : '',
    v.rows.map((r) => `${r.label}: ${r.value}`).join('\n'),
    v.quote ? `${v.quote.label}:\n"${v.quote.text}"` : '',
    `${v.primary.label}: ${v.primary.href}`,
    ...v.secondary.map((s) => `${s.label}: ${s.href}`),
    v.sentLine,
  ].filter(Boolean);
  const f = v.footer;
  return `${parts.join('\n\n')}\n\n---\n${f.helpLine} ${f.help}\n${f.replyNote ? `${f.replyNote}\n` : ''}${f.why}${f.prefsUrl ? `\n${f.prefs}: ${f.prefsUrl}` : ''}\n${c.company} · ${c.site}\n`;
}

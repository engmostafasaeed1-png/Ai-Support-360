// SLA reminder / escalation / breach e-mail (docs/sql/sla-policies.sql queues one row per person and step).
// Shared modern layout of the platform (white body, brand header, status chip, CTA, contact footer); EN/AR with RTL.
// Polite and factual: the platform measures and reminds, it does not guarantee delivery. Plain text and HTML.
import { esc, safeUrl } from './referralEmail.ts';

export type SlaEmailKind = 'reminder' | 'escalation' | 'breach' | 'after_breach';
export const SLA_EMAIL_KINDS: readonly SlaEmailKind[] = ['reminder', 'escalation', 'breach', 'after_breach'];
type Lang = 'en' | 'ar';

export interface SlaEmailInput {
  kind: SlaEmailKind;
  lang?: Lang;
  ticketTitle?: string;
  severity?: string;
  clock?: 'response' | 'workaround' | 'resolution';
  leftMin?: number;
  role?: 'consultant' | 'client' | 'admin';
  path?: string;
  siteUrl?: string;
  contactEmail?: string;
  test?: boolean;
}

export interface RenderedSlaEmail { subject: string; html: string; text: string; preheader: string; lang: Lang }

const SITE = 'https://www.aisupport360.com';

export const normaliseSlaKind = (k: unknown): SlaEmailKind => ((SLA_EMAIL_KINDS as readonly string[]).includes(String(k)) ? (k as SlaEmailKind) : 'reminder');

function minutesText(min: number, lang: Lang): string {
  let m = Math.max(0, Math.round(min));
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  const u = lang === 'ar' ? { d: 'يوم', h: 'ساعة', m: 'دقيقة' } : { d: 'd', h: 'h', m: 'min' };
  if (d) return `${d} ${u.d}${h ? ` ${h} ${u.h}` : ''}`;
  if (h) return `${h} ${u.h}${m ? ` ${m} ${u.m}` : ''}`;
  return `${m} ${u.m}`;
}

const COPY = {
  en: {
    clock: { response: 'first response', workaround: 'workaround', resolution: 'resolution' },
    chip: { reminder: 'Reminder', escalation: 'Escalation', breach: 'Target passed', after_breach: 'Still open' },
    subject: (k: SlaEmailKind, t: string, s: string) => ({
      reminder: `SLA reminder (${s}): ${t}`, escalation: `SLA escalation (${s}): ${t}`,
      breach: `SLA target passed (${s}): ${t}`, after_breach: `Still open after the SLA target (${s}): ${t}`,
    })[k],
    intro: (k: SlaEmailKind, clock: string, t: string, left: string | null) => left && (k === 'reminder' || k === 'escalation')
      ? `The ${clock} for "${t}" is due in about ${left}.`
      : `The ${clock} target for "${t}" has passed.`,
    next: {
      consultant: ['Reply to the client in the ticket, or', 'acknowledge the reminder and add an expected time (ETA) - the client sees it in the timeline.'],
      client: ['Open the ticket to see the latest update.', 'If the target has passed you can extend the time, ask for another consultant or request admin help.'],
      admin: ['Open the ticket to check the situation and help if needed.'],
    },
    nextTitle: 'What you can do now', cta: 'Open the ticket',
    note: 'SLA targets are commitments between the client and the assigned consultant under the ticket\'s policy. AI Support 360 measures and reminds; it does not guarantee delivery.',
    why: 'You receive this e-mail because you work on or follow this ticket on AI Support 360.', contact: 'Questions? Write to',
    test: '[TEST] Sample data only - nothing happened on a real ticket.', hello: 'Hello,', company: 'AI Support 360 by Qurtuba Talks',
  },
  ar: {
    clock: { response: 'الاستجابة الأولى', workaround: 'الحل المؤقت', resolution: 'الحل' },
    chip: { reminder: 'تذكير', escalation: 'تصعيد', breach: 'انتهى الوقت', after_breach: 'ما زال مفتوحاً' },
    subject: (k: SlaEmailKind, t: string, s: string) => ({
      reminder: `تذكير باتفاقية مستوى الخدمة (${s}): ${t}`, escalation: `تصعيد اتفاقية مستوى الخدمة (${s}): ${t}`,
      breach: `انتهى وقت اتفاقية مستوى الخدمة (${s}): ${t}`, after_breach: `ما زال مفتوحاً بعد وقت الاتفاقية (${s}): ${t}`,
    })[k],
    intro: (k: SlaEmailKind, clock: string, t: string, left: string | null) => left && (k === 'reminder' || k === 'escalation')
      ? `موعد ${clock} للتذكرة «${t}» بعد حوالي ${left}.`
      : `انتهى وقت ${clock} للتذكرة «${t}».`,
    next: {
      consultant: ['ردّ على العميل في التذكرة، أو', 'أكّد استلام التذكير وأضف موعداً متوقعاً، وسيراه العميل في سجل التذكرة.'],
      client: ['افتح التذكرة لمعرفة آخر تحديث.', 'إذا انتهى الوقت يمكنك تمديده أو طلب استشاري آخر أو طلب مساعدة الإدارة.'],
      admin: ['افتح التذكرة للتحقق من الوضع والمساعدة عند الحاجة.'],
    },
    nextTitle: 'ما يمكنك فعله الآن', cta: 'فتح التذكرة',
    note: 'أهداف اتفاقية مستوى الخدمة التزامات بين العميل والاستشاري المعيّن وفق سياسة التذكرة. تقيس AI Support 360 الوقت وترسل التذكيرات، ولا تضمن التسليم.',
    why: 'تصلك هذه الرسالة لأنك تعمل على هذه التذكرة أو تتابعها في AI Support 360.', contact: 'أسئلة؟ راسلنا على',
    test: '[تجربة] بيانات مثال فقط، ولم يحدث شيء على تذكرة حقيقية.', hello: 'مرحبًا،', company: 'AI Support 360 من قرطبة توكس',
  },
} as const;

const CHIP_COLOR: Record<SlaEmailKind, [string, string]> = {
  reminder: ['#DBEAFE', '#1E40AF'], escalation: ['#FEF3C7', '#92400E'], breach: ['#FEE2E2', '#991B1B'], after_breach: ['#FEE2E2', '#991B1B'],
};

export function renderSlaEmail(input: SlaEmailInput): RenderedSlaEmail {
  const lang: Lang = input.lang === 'ar' ? 'ar' : 'en';
  const c = COPY[lang];
  const kind = normaliseSlaKind(input.kind);
  const title = String(input.ticketTitle ?? (lang === 'ar' ? 'تذكرة' : 'Ticket')).slice(0, 120);
  const sev = /^S[1-4]$/.test(String(input.severity)) ? String(input.severity) : 'S3';
  const clock = c.clock[input.clock === 'workaround' || input.clock === 'resolution' ? input.clock : 'response'];
  const left = typeof input.leftMin === 'number' && input.leftMin > 0 ? minutesText(input.leftMin, lang) : null;
  const role = input.role === 'client' || input.role === 'admin' ? input.role : 'consultant';
  const site = safeUrl(input.siteUrl ?? SITE, SITE);
  const path = typeof input.path === 'string' && input.path.startsWith('/') && !input.path.startsWith('//') ? input.path : '/';
  const url = safeUrl(`${site.replace(/\/$/, '')}${path}`, site);
  const subject = (input.test ? '' : '') + c.subject(kind, title, sev);
  const intro = c.intro(kind, clock, title, left);
  const next = c.next[role];
  const contact = typeof input.contactEmail === 'string' && /^[^@\s]+@[^@\s]+$/.test(input.contactEmail) ? input.contactEmail : 'info@aisupport360.com';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const [chipBg, chipFg] = CHIP_COLOR[kind];
  const font = lang === 'ar' ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif" : 'Inter, Arial, Helvetica, sans-serif';

  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${font};color:#1B2559;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(intro)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
<tr><td style="background:#1B2559;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;text-align:${align};">AI Support 360</td></tr>
${input.test ? `<tr><td style="background:#FEF3C7;color:#92400E;padding:10px 28px;font-size:13px;text-align:${align};">${esc(c.test)}</td></tr>` : ''}
<tr><td style="padding:28px;text-align:${align};" dir="${dir}">
<span style="display:inline-block;background:${chipBg};color:${chipFg};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:bold;">${esc(c.chip[kind])} · ${esc(sev)}</span>
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.3;color:#1B2559;">${esc(title)}</h1>
<p style="margin:0 0 6px;font-size:15px;color:#334155;">${esc(c.hello)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${esc(intro)}</p>
<p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#1B2559;">${esc(c.nextTitle)}</p>
<ul style="margin:0 0 24px;padding-${lang === 'ar' ? 'right' : 'left'}:20px;font-size:14px;line-height:1.6;color:#334155;">${next.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#3B82F6;">
<a href="${esc(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:12px;">${esc(c.cta)}</a></td></tr></table>
<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748B;">${esc(c.note)}</p>
</td></tr>
<tr><td style="background:#F8FAFC;padding:18px 28px;font-size:12px;line-height:1.6;color:#64748B;text-align:${align};" dir="${dir}">
${esc(c.why)}<br>${esc(c.contact)} <a href="mailto:${esc(contact)}" style="color:#3B82F6;">${esc(contact)}</a><br>${esc(c.company)}
</td></tr></table></td></tr></table></body></html>`;

  const text = [input.test ? c.test : '', `${c.chip[kind]} · ${sev}`, title, '', c.hello, intro, '', `${c.nextTitle}:`, ...next.map((n) => `- ${n}`), '',
    `${c.cta}: ${url}`, '', c.note, '', c.why, `${c.contact} ${contact}`, c.company].filter((l, i) => i > 0 || l).join('\n');
  return { subject, html, text, preheader: intro, lang };
}

export function sampleSlaEmail(kind: SlaEmailKind, lang: Lang): SlaEmailInput {
  return { kind, lang, ticketTitle: lang === 'ar' ? 'تعطل ترحيل الفواتير في FB60' : 'FB60 invoice posting blocked', severity: 'S2',
    clock: kind === 'after_breach' ? 'resolution' : 'response', leftMin: kind === 'reminder' || kind === 'escalation' ? 45 : 0, role: 'consultant',
    path: '/consultant/cases' };
}

/** Telegram / push text (no HTML from users: everything escaped by the senders). */
export function slaShortText(input: SlaEmailInput): { title: string; body: string } {
  const r = renderSlaEmail(input);
  return { title: r.subject.slice(0, 120), body: r.preheader.slice(0, 300) };
}

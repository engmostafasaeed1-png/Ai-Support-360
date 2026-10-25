// Support agreement notice e-mail (docs/sql/support-agreements.sql queues one row per person and event; the text was
// written by the database in the recipient's language). Shared platform layout: white body, brand header, CTA,
// "why staying on the platform protects you" box, contact footer; EN/AR with RTL.
import { esc, safeUrl } from './referralEmail.ts';

type Lang = 'en' | 'ar';
export interface AgreementEmailInput { lang?: Lang; title?: string; body?: string; name?: string; path?: string; role?: string; siteUrl?: string; contactEmail?: string; test?: boolean }

const SITE = 'https://www.aisupport360.com';
const COPY = {
  en: { cta: 'Open the agreement', hello: 'Hello,', protect: 'Why staying on the platform protects you',
    points: ['NDA and confidentiality stay in force', 'Payment protection and invoices through the platform', 'Dispute handling and a clear record of every step', 'SLA tracking and reminders'],
    why: 'You receive this e-mail because you are a party to this support agreement on AI Support 360.', contact: 'Questions? Write to',
    test: '[TEST] Sample data only - nothing happened on a real agreement.', company: 'AI Support 360 by Qurtuba Talks' },
  ar: { cta: 'فتح الاتفاقية', hello: 'مرحبًا،', protect: 'لماذا يحميك البقاء على المنصة',
    points: ['تبقى اتفاقية عدم الإفصاح والسرية سارية', 'حماية الدفع والفواتير عبر المنصة', 'معالجة النزاعات وسجل واضح لكل خطوة', 'متابعة اتفاقية مستوى الخدمة والتذكيرات'],
    why: 'تصلك هذه الرسالة لأنك طرف في اتفاقية الدعم هذه على AI Support 360.', contact: 'أسئلة؟ راسلنا على',
    test: '[تجربة] بيانات مثال فقط، ولم يحدث شيء على اتفاقية حقيقية.', company: 'AI Support 360 من قرطبة توكس' },
} as const;

export function renderAgreementEmail(input: AgreementEmailInput) {
  const lang: Lang = input.lang === 'ar' ? 'ar' : 'en';
  const c = COPY[lang];
  const subject = String(input.title ?? (lang === 'ar' ? 'اتفاقية دعم' : 'Support agreement')).slice(0, 160);
  const body = String(input.body ?? '').slice(0, 1000);
  const site = safeUrl(input.siteUrl ?? SITE, SITE);
  const path = typeof input.path === 'string' && input.path.startsWith('/') && !input.path.startsWith('//') ? input.path : '/';
  const url = safeUrl(`${site.replace(/\/$/, '')}${path}`, site);
  const contact = typeof input.contactEmail === 'string' && /^[^@\s]+@[^@\s]+$/.test(input.contactEmail) ? input.contactEmail : 'info@aisupport360.com';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const font = lang === 'ar' ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif" : 'Inter, Arial, Helvetica, sans-serif';
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${font};color:#1B2559;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(body)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
<tr><td style="background:#1B2559;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;text-align:${align};">AI Support 360</td></tr>
${input.test ? `<tr><td style="background:#FEF3C7;color:#92400E;padding:10px 28px;font-size:13px;text-align:${align};">${esc(c.test)}</td></tr>` : ''}
<tr><td style="padding:28px;text-align:${align};" dir="${dir}">
${input.name ? `<span style="display:inline-block;background:#DBEAFE;color:#1E40AF;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:bold;">${esc(String(input.name).slice(0, 120))}</span>` : ''}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.3;color:#1B2559;">${esc(subject)}</h1>
<p style="margin:0 0 6px;font-size:15px;color:#334155;">${esc(c.hello)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${esc(body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#3B82F6;">
<a href="${esc(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:12px;">${esc(c.cta)}</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#F8FAFC;border-radius:12px;"><tr><td style="padding:14px 18px;font-size:13px;line-height:1.6;color:#334155;">
<strong>${esc(c.protect)}</strong><ul style="margin:6px 0 0;padding-${lang === 'ar' ? 'right' : 'left'}:18px;">${c.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td></tr></table>
</td></tr>
<tr><td style="background:#F8FAFC;padding:18px 28px;font-size:12px;line-height:1.6;color:#64748B;text-align:${align};" dir="${dir}">
${esc(c.why)}<br>${esc(c.contact)} <a href="mailto:${esc(contact)}" style="color:#3B82F6;">${esc(contact)}</a><br>${esc(c.company)}
</td></tr></table></td></tr></table></body></html>`;
  const text = [input.test ? c.test : '', input.name ?? '', subject, '', c.hello, body, '', `${c.cta}: ${url}`, '', `${c.protect}:`, ...c.points.map((x) => `- ${x}`), '', c.why, `${c.contact} ${contact}`, c.company]
    .filter((l, i) => i > 1 || l).join('\n');
  return { subject, html, text, preheader: body, lang };
}

export function sampleAgreementEmail(lang: Lang): AgreementEmailInput {
  return lang === 'ar'
    ? { lang, name: 'دعم FI 2027', title: 'تم الاتفاق على اتفاقية الدعم: دعم FI 2027', body: 'قبل الطرفان الإصدار 2. تبدأ في تاريخ البدء بعد توقيع اتفاقية عدم الإفصاح من الطرفين.', path: '/client/agreements' }
    : { lang, name: 'FI support 2027', title: 'Support agreement agreed: FI support 2027', body: 'Both parties accepted version 2. It starts on the start date once the NDA is signed by both.', path: '/client/agreements' };
}

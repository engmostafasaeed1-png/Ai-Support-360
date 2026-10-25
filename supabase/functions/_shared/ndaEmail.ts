// NDA signing e-mails (nda-signature edge function): "<name> signed the NDA, your signature is needed", the reminder
// and "fully signed". Shared modern platform layout: white body, brand header, CTA deep link, contact footer; EN/AR + RTL.
// One recipient per event; the database decides who (nda_sign_record / nda_reminder_record).
import { esc, safeUrl } from './referralEmail.ts';

type Lang = 'en' | 'ar';
export type NdaMailKind = 'needs_signature' | 'reminder' | 'fully_signed';
export interface NdaEmailInput { lang?: Lang; kind?: NdaMailKind; signer?: string; path?: string; siteUrl?: string; contactEmail?: string; test?: boolean }

const SITE = 'https://www.aisupport360.com';
const COPY = {
  en: {
    subject: { needs_signature: (n: string) => `${n} signed the NDA, your signature is needed`, reminder: (n: string) => `Reminder: ${n} is waiting for your NDA signature`, fully_signed: () => 'The NDA is fully signed' },
    body: {
      needs_signature: (n: string) => `${n} signed the Non-Disclosure Agreement. Please review it and add your signature: protected information is shared only after both signatures.`,
      reminder: (n: string) => `${n} is still waiting for your signature on the Non-Disclosure Agreement. Open the NDA to review and sign it.`,
      fully_signed: (n: string) => `${n} signed the Non-Disclosure Agreement. Both signatures are on the document and the fully signed copy is ready to download.`,
    },
    cta: { needs_signature: 'Review and sign', reminder: 'Review and sign', fully_signed: 'Download the signed NDA' },
    hello: 'Hello,', how: 'To sign you draw your signature, type your full legal name and add your ID document details. The other party sees only a masked ID number.',
    why: 'You receive this e-mail because you are a party to this NDA on AI Support 360.', contact: 'Questions? Write to',
    test: '[TEST] Sample data only - nothing happened on a real NDA.', company: 'AI Support 360 by Qurtuba Talks',
  },
  ar: {
    subject: { needs_signature: (n: string) => `وقّع ${n} اتفاقية عدم الإفصاح، وتوقيعك مطلوب`, reminder: (n: string) => `تذكير: ${n} بانتظار توقيعك على اتفاقية عدم الإفصاح`, fully_signed: () => 'اكتمل توقيع اتفاقية عدم الإفصاح' },
    body: {
      needs_signature: (n: string) => `وقّع ${n} اتفاقية عدم الإفصاح. يرجى مراجعتها وإضافة توقيعك، فلا تتم مشاركة المعلومات المحمية إلا بعد توقيع الطرفين.`,
      reminder: (n: string) => `لا يزال ${n} بانتظار توقيعك على اتفاقية عدم الإفصاح. افتح الاتفاقية لمراجعتها وتوقيعها.`,
      fully_signed: (n: string) => `وقّع ${n} اتفاقية عدم الإفصاح. أصبح التوقيعان على المستند والنسخة الموقعة بالكامل جاهزة للتنزيل.`,
    },
    cta: { needs_signature: 'المراجعة والتوقيع', reminder: 'المراجعة والتوقيع', fully_signed: 'تنزيل الاتفاقية الموقعة' },
    hello: 'مرحبًا،', how: 'للتوقيع ترسم توقيعك بيدك وتكتب اسمك القانوني الكامل وتضيف بيانات وثيقة الهوية. يرى الطرف الآخر رقم الهوية مخفيًا جزئيًا فقط.',
    why: 'تصلك هذه الرسالة لأنك طرف في اتفاقية عدم الإفصاح هذه على AI Support 360.', contact: 'أسئلة؟ راسلنا على',
    test: '[تجربة] بيانات مثال فقط، ولم يحدث شيء على اتفاقية حقيقية.', company: 'AI Support 360 من قرطبة توكس',
  },
} as const;

export function renderNdaEmail(input: NdaEmailInput) {
  const lang: Lang = input.lang === 'ar' ? 'ar' : 'en';
  const kind: NdaMailKind = input.kind === 'reminder' || input.kind === 'fully_signed' ? input.kind : 'needs_signature';
  const c = COPY[lang];
  const signer = String(input.signer ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || (lang === 'ar' ? 'الطرف الآخر' : 'The other party');
  const subject = c.subject[kind](signer).slice(0, 160);
  const body = c.body[kind](signer);
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
<span style="display:inline-block;background:#DBEAFE;color:#1E40AF;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:bold;">NDA</span>
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.3;color:#1B2559;">${esc(subject)}</h1>
<p style="margin:0 0 6px;font-size:15px;color:#334155;">${esc(c.hello)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${esc(body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#3B82F6;">
<a href="${esc(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:12px;">${esc(c.cta[kind])}</a></td></tr></table>
${kind === 'fully_signed' ? '' : `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748B;">${esc(c.how)}</p>`}
</td></tr>
<tr><td style="background:#F8FAFC;padding:18px 28px;font-size:12px;line-height:1.6;color:#64748B;text-align:${align};" dir="${dir}">
${esc(c.why)}<br>${esc(c.contact)} <a href="mailto:${esc(contact)}" style="color:#3B82F6;">${esc(contact)}</a><br>${esc(c.company)}
</td></tr></table></td></tr></table></body></html>`;
  const text = [input.test ? c.test : '', subject, '', c.hello, body, '', `${c.cta[kind]}: ${url}`, '', kind === 'fully_signed' ? '' : c.how, '', c.why, `${c.contact} ${contact}`, c.company]
    .filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n');
  return { subject, html, text, preheader: body, lang, kind };
}

export function sampleNdaEmail(lang: Lang): NdaEmailInput {
  return lang === 'ar'
    ? { lang, kind: 'needs_signature', signer: 'م. س****', path: '/client/contracts' }
    : { lang, kind: 'needs_signature', signer: 'M. S****', path: '/client/contracts' };
}

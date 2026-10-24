// BRD approval e-mails (docs/sql/ticket-brd-approval.sql queue): one layout shared by the worker (brd-approval-run),
// the admin preview and the admin test send, so preview and real mail never differ. Same modern look as the
// Refer & earn mails (rounded white card, brand header, gradient hero, chip, panels, bulletproof button), with the
// hero colour following the outcome: green approved, amber changes / waiting, red declined, brand otherwise.
// Every value is escaped; links only to our own domain; bilingual (EN / AR, RTL); no images required.
import { esc, safeUrl } from './referralEmail.ts';

export type BrdApprovalEmailKind = 'request' | 'reminder' | 'fyi' | 'approved' | 'changes_requested' | 'declined' | 'client_waiting' | 'admin_declined' | 'admin_escalation';
export const BRD_APPROVAL_EMAIL_KINDS: readonly BrdApprovalEmailKind[] = ['request', 'reminder', 'fyi', 'approved', 'changes_requested', 'declined', 'client_waiting', 'admin_declined', 'admin_escalation'];
type Lang = 'en' | 'ar';
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BrdApprovalEmailInput {
  kind: BrdApprovalEmailKind | string;
  lang?: Lang | string;
  ticketTitle?: string;
  version?: number;
  previousVersion?: number | null;
  ref?: string;
  who?: string;
  note?: string;
  summary?: string;
  changedSections?: string[];
  days?: number;
  dueAt?: string | null;
  path?: string;
  siteUrl?: string;
  contactEmail?: string;
  test?: boolean;
}

export interface RenderedBrdApprovalEmail { subject: string; html: string; text: string; preheader: string; kind: BrdApprovalEmailKind; lang: Lang }

const SITE = 'https://www.aisupport360.com';
const FONT_EN = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_AR = "Tahoma, 'Segoe UI', 'Geeza Pro', Arial, sans-serif";
const CANVAS = '#F3F5FA';
const HERO: Record<Tone, { from: string; to: string; solid: string; chipBg: string; chipFg: string }> = {
  brand: { from: '#1B2559', to: '#3B82F6', solid: '#1B2559', chipBg: '#DBEAFE', chipFg: '#1E3A8A' },
  info: { from: '#1E3A8A', to: '#0EA5E9', solid: '#1E3A8A', chipBg: '#E0F2FE', chipFg: '#075985' },
  success: { from: '#166534', to: '#0F766E', solid: '#166534', chipBg: '#DCFCE7', chipFg: '#166534' },
  warning: { from: '#92400E', to: '#D97706', solid: '#92400E', chipBg: '#FEF3C7', chipFg: '#92400E' },
  danger: { from: '#991B1B', to: '#DC2626', solid: '#991B1B', chipBg: '#FEE2E2', chipFg: '#991B1B' },
};
const TONE: Record<BrdApprovalEmailKind, Tone> = {
  request: 'brand', reminder: 'warning', fyi: 'info', approved: 'success', changes_requested: 'warning', declined: 'danger',
  client_waiting: 'warning', admin_declined: 'danger', admin_escalation: 'warning',
};

interface Ctx { v: string; p: string; t: string; who: string; days: string; ref: string; due: string }
type Copy = {
  chip: string; subject: (c: Ctx) => string; headline: (c: Ctx) => string; intro: (c: Ctx) => string;
  cta: string; noteLabel?: string; next?: (c: Ctx) => string[];
};

const COPY: Record<Lang, { k: Record<BrdApprovalEmailKind, Copy>; summary: string; changed: (p: string) => string; nothingChanged: string; due: (d: string) => string;
  bound: string; contact: string; why: string; prefs: string; company: string; test: string; hello: string; nextTitle: string }> = {
  en: {
    summary: 'Summary', changed: (p) => `What changed since v${p} (the version you approved)`, nothingChanged: 'Only the wording changed; no section was added or removed.',
    due: (d) => `Please decide by ${d}.`, bound: 'Your decision is recorded for this exact version and its content fingerprint.',
    contact: 'Questions? Write to', why: 'You receive this e-mail because you work on this ticket on AI Support 360.', prefs: 'E-mail settings',
    company: 'AI Support 360 by Qurtuba Talks', test: '[TEST] This is a sample with example data. Nothing happened on a real ticket.', hello: 'Hello,',
    nextTitle: 'What you can do next',
    k: {
      request: { chip: 'Approval needed', subject: (c) => `Please approve BRD v${c.v} - ${c.t}`, headline: (c) => `Please approve BRD v${c.v}`,
        intro: (c) => `The client shared version ${c.v} of the Business Requirements Document for "${c.t}". Please read it, then approve it, ask for changes, or decline.`, cta: 'Review the BRD', noteLabel: 'Note from the client' },
      reminder: { chip: 'Reminder', subject: (c) => `Reminder: BRD v${c.v} is waiting for your approval`, headline: (c) => `BRD v${c.v} is waiting for you`,
        intro: (c) => `Version ${c.v} of the BRD for "${c.t}" has waited ${c.days} days for your decision. Work on the ticket starts after the BRD is approved.`, cta: 'Review the BRD' },
      fyi: { chip: 'For your information', subject: (c) => `BRD v${c.v} shared - no material change`, headline: (c) => `BRD v${c.v}: no material change`,
        intro: (c) => `The client shared version ${c.v} of the BRD for "${c.t}" and marked it as having no material change. Your approval of v${c.p} still applies.`, cta: 'Open the BRD' },
      approved: { chip: 'Approved', subject: (c) => `BRD v${c.v} approved - work can start`, headline: (c) => `BRD v${c.v} approved`,
        intro: (c) => `${c.who} approved version ${c.v} of the BRD for "${c.t}". Work can start on the agreed scope.`, cta: 'Open the ticket', noteLabel: 'Comment' },
      changes_requested: { chip: 'Changes requested', subject: (c) => `Changes requested on BRD v${c.v}`, headline: (c) => `Changes requested on BRD v${c.v}`,
        intro: (c) => `${c.who} asked for changes to the BRD for "${c.t}" before approving it.`, cta: 'Edit the BRD', noteLabel: 'Requested changes',
        next: () => ['Edit the BRD and save a new version.', 'Attach the new version and ask for approval again.'] },
      declined: { chip: 'Declined', subject: (c) => `BRD v${c.v} was declined`, headline: (c) => `BRD v${c.v} was declined`,
        intro: (c) => `${c.who} declined version ${c.v} of the BRD for "${c.t}".`, cta: 'Open the ticket', noteLabel: 'Reason',
        next: () => ['Choose another consultant from the ticket page.', 'Or update the BRD and ask for approval again.', 'Need help? Our support team can advise.'] },
      client_waiting: { chip: 'Still waiting', subject: (c) => `Still waiting for approval of BRD v${c.v}`, headline: (c) => `Still waiting for BRD v${c.v} approval`,
        intro: (c) => `The consultant has not yet decided on version ${c.v} of the BRD for "${c.t}" (${c.days} days).`, cta: 'Open the BRD',
        next: () => ['Send the consultant a message on the ticket.', 'Withdraw the request and continue without a BRD.', 'Contact support if you need another consultant.'] },
      admin_declined: { chip: 'Declined', subject: (c) => `A consultant declined BRD v${c.v} (ticket ${c.ref})`, headline: (c) => `BRD v${c.v} declined on ticket ${c.ref}`,
        intro: (c) => `${c.who} declined version ${c.v} of the BRD for "${c.t}". The client was told and can choose another consultant.`, cta: 'Open the ticket', noteLabel: 'Reason' },
      admin_escalation: { chip: 'Overdue', subject: (c) => `BRD approval overdue on ticket ${c.ref}`, headline: (c) => `BRD v${c.v} approval is overdue`,
        intro: (c) => `Version ${c.v} of the BRD for "${c.t}" has waited ${c.days} days for consultant approval.`, cta: 'Open the ticket' },
    },
  },
  ar: {
    summary: 'ملخص', changed: (p) => `ما الذي تغيّر منذ الإصدار ${p} (الإصدار الذي اعتمدته)`, nothingChanged: 'تغيّرت الصياغة فقط، ولم يُضف أي قسم أو يُحذف.',
    due: (d) => `يرجى اتخاذ القرار قبل ${d}.`, bound: 'يُسجَّل قرارك لهذا الإصدار نفسه ولبصمة محتواه.',
    contact: 'أسئلة؟ راسلنا على', why: 'تصلك هذه الرسالة لأنك تعمل على هذه التذكرة في AI Support 360.', prefs: 'إعدادات البريد',
    company: 'AI Support 360 من قرطبة توكس', test: '[تجربة] هذه عيّنة ببيانات مثال، ولم يحدث شيء على تذكرة حقيقية.', hello: 'مرحبًا،',
    nextTitle: 'ما يمكنك فعله الآن',
    k: {
      request: { chip: 'مطلوب اعتماد', subject: (c) => `يرجى اعتماد وثيقة المتطلبات الإصدار ${c.v} - ${c.t}`, headline: (c) => `يرجى اعتماد الإصدار ${c.v} من وثيقة المتطلبات`,
        intro: (c) => `شارك العميل الإصدار ${c.v} من وثيقة متطلبات الأعمال لطلب "${c.t}". يرجى قراءتها ثم اعتمادها أو طلب تعديلات أو رفضها.`, cta: 'مراجعة الوثيقة', noteLabel: 'ملاحظة من العميل' },
      reminder: { chip: 'تذكير', subject: (c) => `تذكير: الإصدار ${c.v} من وثيقة المتطلبات بانتظار اعتمادك`, headline: (c) => `الإصدار ${c.v} بانتظارك`,
        intro: (c) => `ينتظر الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}" قرارك منذ ${c.days} أيام. يبدأ العمل على التذكرة بعد اعتماد الوثيقة.`, cta: 'مراجعة الوثيقة' },
      fyi: { chip: 'للعلم', subject: (c) => `مشاركة الإصدار ${c.v} - دون تغيير جوهري`, headline: (c) => `الإصدار ${c.v}: دون تغيير جوهري`,
        intro: (c) => `شارك العميل الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}" وأشار إلى أنه دون تغيير جوهري. يبقى اعتمادك للإصدار ${c.p} ساريًا.`, cta: 'فتح الوثيقة' },
      approved: { chip: 'معتمد', subject: (c) => `اعتُمد الإصدار ${c.v} من وثيقة المتطلبات - يمكن بدء العمل`, headline: (c) => `اعتُمد الإصدار ${c.v}`,
        intro: (c) => `اعتمد ${c.who} الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}". يمكن بدء العمل وفق النطاق المتفق عليه.`, cta: 'فتح التذكرة', noteLabel: 'تعليق' },
      changes_requested: { chip: 'طُلبت تعديلات', subject: (c) => `طُلبت تعديلات على الإصدار ${c.v} من وثيقة المتطلبات`, headline: (c) => `طُلبت تعديلات على الإصدار ${c.v}`,
        intro: (c) => `طلب ${c.who} إجراء تعديلات على وثيقة المتطلبات لطلب "${c.t}" قبل اعتمادها.`, cta: 'تعديل الوثيقة', noteLabel: 'التعديلات المطلوبة',
        next: () => ['عدّل الوثيقة واحفظ إصدارًا جديدًا.', 'أرفق الإصدار الجديد واطلب الاعتماد مرة أخرى.'] },
      declined: { chip: 'مرفوض', subject: (c) => `رُفض الإصدار ${c.v} من وثيقة المتطلبات`, headline: (c) => `رُفض الإصدار ${c.v}`,
        intro: (c) => `رفض ${c.who} الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}".`, cta: 'فتح التذكرة', noteLabel: 'السبب',
        next: () => ['اختر مستشارًا آخر من صفحة التذكرة.', 'أو حدّث الوثيقة واطلب الاعتماد مرة أخرى.', 'هل تحتاج مساعدة؟ فريق الدعم جاهز.'] },
      client_waiting: { chip: 'ما زال بالانتظار', subject: (c) => `ما زلنا بانتظار اعتماد الإصدار ${c.v} من وثيقة المتطلبات`, headline: (c) => `ما زال الإصدار ${c.v} بانتظار الاعتماد`,
        intro: (c) => `لم يتخذ المستشار قراره بعد بشأن الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}" (${c.days} أيام).`, cta: 'فتح الوثيقة',
        next: () => ['أرسل رسالة إلى المستشار على التذكرة.', 'اسحب الطلب وتابع دون وثيقة متطلبات.', 'تواصل مع الدعم إن احتجت مستشارًا آخر.'] },
      admin_declined: { chip: 'مرفوض', subject: (c) => `رفض مستشار الإصدار ${c.v} (التذكرة ${c.ref})`, headline: (c) => `رُفض الإصدار ${c.v} في التذكرة ${c.ref}`,
        intro: (c) => `رفض ${c.who} الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}". أُبلغ العميل ويمكنه اختيار مستشار آخر.`, cta: 'فتح التذكرة', noteLabel: 'السبب' },
      admin_escalation: { chip: 'متأخر', subject: (c) => `تأخر اعتماد وثيقة المتطلبات في التذكرة ${c.ref}`, headline: (c) => `تأخر اعتماد الإصدار ${c.v}`,
        intro: (c) => `ينتظر الإصدار ${c.v} من وثيقة المتطلبات لطلب "${c.t}" اعتماد المستشار منذ ${c.days} أيام.`, cta: 'فتح التذكرة' },
    },
  },
};

const KIND_SET = new Set<string>(BRD_APPROVAL_EMAIL_KINDS);
export const normaliseBrdKind = (k: unknown): BrdApprovalEmailKind => (KIND_SET.has(String(k)) ? (k as BrdApprovalEmailKind) : 'request');
const clip = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const PATH_RE = /^\/(client\/tickets|consultant\/cases|admin\/tickets)\/[0-9a-f-]{36}(\/brd)?$/;

export function pauseCategoryForBrd(kind: BrdApprovalEmailKind): 'reminders' | 'activity' {
  return kind === 'reminder' || kind === 'client_waiting' || kind === 'admin_escalation' ? 'reminders' : 'activity';
}

function fmtDate(iso: string | null | undefined, lang: Lang): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function renderBrdApprovalEmail(input: BrdApprovalEmailInput): RenderedBrdApprovalEmail {
  const lang: Lang = input.lang === 'ar' ? 'ar' : 'en';
  const kind = normaliseBrdKind(input.kind);
  const L = COPY[lang];
  const k = L.k[kind];
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const end = rtl ? 'left' : 'right';
  const font = rtl ? FONT_AR : FONT_EN;
  const hero = HERO[TONE[kind]];
  const site = safeUrl(input.siteUrl || SITE).replace(/\/+$/, '');
  const path = PATH_RE.test(String(input.path ?? '')) ? String(input.path) : '';
  const url = safeUrl(path ? `${site}${path}` : site);
  const prefs = safeUrl(`${site}${kind.startsWith('admin_') ? '/admin' : path.startsWith('/client') ? '/client/settings' : '/consultant/settings'}`);
  const v = Number.isFinite(Number(input.version)) && Number(input.version) > 0 ? String(Math.floor(Number(input.version))) : '1';
  const p = Number.isFinite(Number(input.previousVersion)) && Number(input.previousVersion) > 0 ? String(Math.floor(Number(input.previousVersion))) : '';
  const ctx: Ctx = {
    v, p, t: clip(input.ticketTitle, 120) || (rtl ? 'تذكرتك' : 'your ticket'), who: clip(input.who, 80) || (rtl ? 'المستشار' : 'The consultant'),
    days: String(Math.max(0, Math.floor(Number(input.days) || 0))), ref: clip(input.ref, 12).replace(/[^A-Z0-9]/gi, ''), due: fmtDate(input.dueAt, lang),
  };
  const subject = `${input.test ? '[TEST] ' : ''}${k.subject(ctx)}`.slice(0, 200);
  const intro = k.intro(ctx);
  const preheader = intro.length > 110 ? `${intro.slice(0, 107)}…` : intro;
  const note = clip(input.note, 1500);
  const summary = clip(input.summary, 240);
  const changed = (input.changedSections ?? []).map((s) => clip(s, 60)).filter(Boolean).slice(0, 16);
  const contact = /^[a-z0-9._+-]+@(www\.)?aisupport360\.com$/i.test(String(input.contactEmail ?? '').trim())
    ? String(input.contactEmail).trim().toLowerCase() : 'info@aisupport360.com';

  const P = (txt: string, extra = '') => `<p style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:1.65;color:#1F2937;text-align:${align}${extra}">${esc(txt)}</p>`;
  const H = (txt: string) => `<p style="margin:6px 0 10px;font-family:${font};font-size:17px;font-weight:800;color:#111827;text-align:${align}">${esc(txt)}</p>`;
  const panel = (inner: string, bg = '#F8FAFC', border = '#E5E7EB') =>
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px"><tr><td style="padding:16px 18px;border-radius:14px;background:${bg};border:1px solid ${border};text-align:${align}">${inner}</td></tr></table>`;
  const list = (items: string[], color: string) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="${dir}">${items.map((x) =>
    `<tr><td width="22" valign="top" style="padding:3px 0;font-family:${font};font-size:15px;color:${color};font-weight:800">&#8226;</td><td style="padding:3px 0;font-family:${font};font-size:15px;line-height:1.55;color:#1F2937;text-align:${align}">${esc(x)}</td></tr>`).join('')}</table>`;

  const parts: string[] = [];
  if (input.test) parts.push(panel(`<p style="margin:0;font-family:${font};font-size:13px;color:#92400E">${esc(L.test)}</p>`, '#FFFBEB', '#FDE68A'));
  parts.push(P(L.hello), P(intro));
  if (summary && (kind === 'request' || kind === 'reminder')) {
    parts.push(panel(`<p style="margin:0 0 6px;font-family:${font};font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#64748B">${esc(L.summary)}</p>`
      + `<p style="margin:0;font-family:${font};font-size:15px;line-height:1.6;color:#111827">${esc(summary)}</p>`));
  }
  if (p && (kind === 'request' || kind === 'reminder')) {
    parts.push(H(L.changed(p)), changed.length ? list(changed, hero.solid) : P(L.nothingChanged, ';color:#475569;font-size:14px'));
  }
  if (note && k.noteLabel) {
    const tone = TONE[kind];
    const bg = tone === 'danger' ? '#FEF2F2' : tone === 'warning' ? '#FFFBEB' : tone === 'success' ? '#F0FDF4' : '#F8FAFC';
    const bd = tone === 'danger' ? '#FECACA' : tone === 'warning' ? '#FDE68A' : tone === 'success' ? '#BBF7D0' : '#E5E7EB';
    parts.push(panel(`<p style="margin:0 0 6px;font-family:${font};font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#64748B">${esc(k.noteLabel)}</p>`
      + `<p style="margin:0;font-family:${font};font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap">${esc(note)}</p>`, bg, bd));
  }
  if (k.next) parts.push(H(L.nextTitle), list(k.next(ctx), hero.solid));
  if (ctx.due && (kind === 'request' || kind === 'reminder')) parts.push(P(L.due(ctx.due), ';font-weight:700'));

  const button = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:26px auto 10px"><tr><td align="center" bgcolor="${hero.solid}" style="border-radius:999px;background:${hero.solid};background-image:linear-gradient(135deg,${hero.from},${hero.to})">`
    + `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(url)}" style="height:54px;v-text-anchor:middle;width:300px" arcsize="50%" stroke="f" fillcolor="${hero.solid}"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold">${esc(k.cta)}</center></v:roundrect><![endif]-->`
    + `<!--[if !mso]><!--><a href="${esc(url)}" target="_blank" style="display:inline-block;padding:17px 42px;font-family:${font};font-size:17px;font-weight:800;line-height:20px;color:#ffffff;text-decoration:none;border-radius:999px;background:${hero.solid};background-image:linear-gradient(135deg,${hero.from},${hero.to})">${esc(k.cta)} ${rtl ? '&larr;' : '&rarr;'}</a><!--<![endif]-->`
    + `</td></tr></table>`;
  parts.push(button);
  if (kind === 'request' || kind === 'reminder') parts.push(`<p style="margin:6px 0 0;font-family:${font};font-size:12px;line-height:1.6;color:#64748B;text-align:center">${esc(L.bound)}</p>`);

  const logo = `${SITE}/icon-192.png`;
  const chip = `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${hero.chipBg};color:${hero.chipFg};font-family:${font};font-size:12px;font-weight:800;line-height:18px;white-space:nowrap">${esc(k.chip)}</span>`;
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:${CANVAS}" dir="${dir}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${CANVAS}" style="background:${CANVAS}"><tr><td align="center" style="padding:28px 10px">`
    + `<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" dir="${dir}" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #E5E9F2;border-radius:24px;border-collapse:separate;overflow:hidden">`
    + `<tr><td style="padding:20px 24px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="${dir}"><tr>`
    + `<td style="text-align:${align}"><a href="${esc(site)}" target="_blank" style="text-decoration:none"><img src="${esc(logo)}" width="36" height="36" alt="AI Support 360" style="vertical-align:middle;border:0;border-radius:10px" /> <span style="font-family:${FONT_EN};font-size:17px;font-weight:800;color:#1B2559;vertical-align:middle">AI Support 360</span></a></td>`
    + `<td align="${end}" style="text-align:${end};font-family:${font};font-size:12px;color:#64748B;white-space:nowrap">${esc(rtl ? 'وثيقة متطلبات الأعمال' : 'Business Requirements Document')}</td></tr></table></td></tr>`
    + `<tr><td style="padding:0 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${hero.solid}" style="padding:30px 26px;border-radius:20px;background:${hero.solid};background-image:linear-gradient(135deg,${hero.from} 0%,${hero.to} 100%);text-align:${align}">`
    + `<p style="margin:0 0 12px">${chip}</p>`
    + `<h1 style="margin:0;font-family:${font};font-size:28px;line-height:1.25;font-weight:800;color:#ffffff">${esc(k.headline(ctx))}</h1>`
    + `<p style="margin:10px 0 0;font-family:${font};font-size:14px;line-height:1.5;color:#E2E8F0">${esc(ctx.t)}${ctx.ref ? ` · #${esc(ctx.ref)}` : ''}</p>`
    + `</td></tr></table></td></tr>`
    + `<tr><td style="padding:28px 28px 24px">${parts.join('')}</td></tr>`
    + `<tr><td bgcolor="#F8FAFC" style="padding:20px 28px 24px;background:#F8FAFC;border-top:1px solid #EEF0F4;text-align:${align}">`
    + `<p style="margin:0 0 8px;font-family:${font};font-size:13px;line-height:1.6;color:#475569">${esc(L.contact)} <a href="mailto:${esc(contact)}" style="color:#1B2559;font-weight:700;text-decoration:underline" dir="ltr">${esc(contact)}</a></p>`
    + `<p style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:1.6;color:#64748B">${esc(L.why)} <a href="${esc(prefs)}" target="_blank" style="color:#475569;text-decoration:underline">${esc(L.prefs)}</a></p>`
    + `<p style="margin:8px 0 0;font-family:${font};font-size:12px;color:#94A3B8">${esc(L.company)}</p>`
    + `</td></tr></table><div style="height:20px;line-height:20px;font-size:0">&nbsp;</div></td></tr></table></body></html>`;

  const out: string[] = [];
  if (input.test) out.push(L.test, '');
  out.push(`${k.chip.toUpperCase()} - ${k.headline(ctx)}`, '', L.hello, intro);
  if (summary && (kind === 'request' || kind === 'reminder')) out.push('', `${L.summary}: ${summary}`);
  if (p && (kind === 'request' || kind === 'reminder')) out.push('', L.changed(p), ...(changed.length ? changed.map((x) => `- ${x}`) : [L.nothingChanged]));
  if (note && k.noteLabel) out.push('', `${k.noteLabel}:`, note);
  if (k.next) out.push('', L.nextTitle, ...k.next(ctx).map((x) => `- ${x}`));
  if (ctx.due && (kind === 'request' || kind === 'reminder')) out.push('', L.due(ctx.due));
  out.push('', `${k.cta}: ${url}`, '', `${L.contact} ${contact}`, L.why, L.company);
  return { subject, html, text: out.join('\n'), preheader, kind, lang };
}

/** Example data for the admin preview and the [TEST] send (no real ticket, person or text). */
export function sampleBrdApprovalEmail(kind: BrdApprovalEmailKind, lang: Lang): BrdApprovalEmailInput {
  const ar = lang === 'ar';
  return {
    kind, lang, version: 3, previousVersion: kind === 'request' || kind === 'reminder' || kind === 'fyi' ? 2 : null, ref: 'A1B2C3D4',
    ticketTitle: ar ? 'تعذّر ترحيل الفواتير في MIRO' : 'MIRO invoice posting blocked',
    who: ar ? 'م. س****' : 'M. S****', days: kind === 'admin_escalation' ? 5 : kind === 'client_waiting' ? 3 : 2,
    summary: ar ? 'تحديد سبب حظر ترحيل الفواتير في رمز الشركة 1000 وإصلاحه دون تغيير إعدادات التحمل الحالية.' : 'Find and fix why invoice posting is blocked in company code 1000 without changing the current tolerance settings.',
    changedSections: ar ? ['النطاق', 'المتطلبات الوظيفية'] : ['Scope', 'Functional requirements'],
    note: kind === 'approved' ? (ar ? 'الوثيقة واضحة ومكتملة.' : 'The document is clear and complete.')
      : kind === 'request' ? (ar ? 'يرجى المراجعة قبل يوم الخميس.' : 'Please review before Thursday.')
      : ar ? 'يرجى إضافة حدود التحمل لرمز الشركة 1000.' : 'Please add the tolerance limits for company code 1000.',
    dueAt: '2026-11-02T09:00:00Z', path: kind.startsWith('admin_') ? '/admin/tickets/00000000-0000-0000-0000-000000000000'
      : ['approved', 'changes_requested', 'declined', 'client_waiting'].includes(kind) ? '/client/tickets/00000000-0000-0000-0000-000000000000/brd'
      : '/consultant/cases/00000000-0000-0000-0000-000000000000/brd',
  };
}

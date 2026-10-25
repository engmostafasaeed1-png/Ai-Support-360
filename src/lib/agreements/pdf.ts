// "Agreement summary" PDF (one terms version): parties, scope, term, rate, hours model, SLA snapshot, notice, renewal,
// platform terms and the electronic acceptance record with the version hash. Built in the browser with the shared
// bilingual PDF writer of the BRD (same embedded IBM Plex Sans Arabic font and bidi layout).
import type { jsPDF } from 'jspdf';
import { C, CW, FONT, H, ML, plain, Writer, loadBrdFonts, type BrdPdfFonts, type JsPdfCtor } from '@/lib/brd/pdf';
import type { SaTerms } from './model';

type Lang = 'en' | 'ar';

export interface AgreementPdfInput {
  name: string;
  status: string;
  version: number;
  hash: string | null;
  clientName: string;
  consultantName: string | null;
  terms: SaTerms;
  acceptances: Array<{ version: number; party: string; name: string; at: string; hash: string }>;
  legalDraft: boolean;
  fees: { service_fee_percent: number; processing_fee_percent: number; vat_percent: number } | null;
  generatedAt?: Date;
}

const L = {
  en: {
    title: 'Support agreement summary', draft: 'DRAFT - pending legal review', parties: 'Parties', client: 'Client', consultant: 'Lead consultant (independent contractor)',
    platform: 'Platform', platformName: 'AI Support 360 by Qurtuba Talks - marketplace and billing facilitator', version: 'Version', hash: 'Version fingerprint', status: 'Status',
    scope: 'Scope', modules: 'SAP areas', versions: 'Versions', systems: 'Systems', covered: 'Covered', notCovered: 'Not covered',
    term: 'Term', start: 'Start', end: 'End', openEnded: 'Open-ended', notice: 'Notice period', days: 'days', renewal: 'Renewal', autoRenew: (m: number) => `Automatic renewal for ${m} months when both parties consented`, manual: 'Renewal by new agreement',
    money: 'Rate and commitment', model: 'Commitment model', models: { payg: 'Pay as you go at the agreed rate', hours_bank: 'Monthly hours bank', availability: 'Availability commitment' },
    rate: 'Agreed hourly rate', s1: 'Critical (S1) multiplier', ooh: 'Out-of-hours multiplier', bank: 'Hours per month', rollover: 'Rollover', unused: 'Unused committed hours', overage: 'Overage rate', capacity: 'Reserved hours per week',
    rollovers: { none: 'No rollover', hours: (n: number) => `Up to ${n} hours`, months: (n: number) => `Up to ${n} months` }, unusedText: { charge: 'Invoiced at month end', forfeit: 'Expire without charge' },
    fees: (s: number, p: number, v: number) => `Billing through the platform: approved timesheets x agreed rate + ${s} % portal fee + ${p} % payment fee + ${v} % VAT. Payouts follow the platform payout rules.`,
    sla: 'Service levels (SLA)', slaDefault: 'Platform default SLA', nda: 'NDA required', yes: 'Yes', no: 'No',
    terms: 'Platform terms',
    clauses: [
      'The consultant is an independent contractor. Nothing in this agreement creates an employment relationship. Each party is responsible for its own taxes.',
      'AI Support 360 is the marketplace and billing facilitator; it is not a party to the consulting work.',
      'Work and payments for the covered scope stay on the platform for the term of this agreement and the period stated in the platform terms.',
      'Contact details stay hidden according to the platform rules; confidentiality follows the NDA between the parties.',
      'Rate changes need the other party\'s approval and apply from a future effective date only, never retroactively.',
      'Either party may end the agreement with the notice period above and a stated reason; a handover period applies.',
    ],
    acceptance: 'Electronic acceptance', party: 'Party', name: 'Name typed', at: 'Accepted at', noAcc: 'Not accepted yet.',
    footer: 'Generated on AI Support 360. This summary reflects the version shown above.', page: (a: number, b: number) => `Page ${a} of ${b}`,
  },
  ar: {
    title: 'ملخص اتفاقية الدعم', draft: 'مسودة - بانتظار المراجعة القانونية', parties: 'الأطراف', client: 'العميل', consultant: 'الاستشاري الرئيسي (متعاقد مستقل)',
    platform: 'المنصة', platformName: 'AI Support 360 من قرطبة توكس - سوق إلكتروني وميسّر للفوترة', version: 'الإصدار', hash: 'بصمة الإصدار', status: 'الحالة',
    scope: 'النطاق', modules: 'مجالات SAP', versions: 'الإصدارات', systems: 'الأنظمة', covered: 'مشمول', notCovered: 'غير مشمول',
    term: 'المدة', start: 'البداية', end: 'النهاية', openEnded: 'مفتوحة', notice: 'فترة الإشعار', days: 'يوم', renewal: 'التجديد', autoRenew: (m: number) => `تجديد تلقائي لمدة ${m} شهراً عند موافقة الطرفين`, manual: 'التجديد باتفاقية جديدة',
    money: 'السعر والالتزام', model: 'نموذج الالتزام', models: { payg: 'الدفع حسب الاستخدام بالسعر المتفق عليه', hours_bank: 'رصيد ساعات شهري', availability: 'التزام بالتوفر' },
    rate: 'سعر الساعة المتفق عليه', s1: 'مضاعف الحالات الحرجة (S1)', ooh: 'مضاعف خارج ساعات العمل', bank: 'الساعات شهرياً', rollover: 'ترحيل الساعات', unused: 'الساعات الملتزم بها غير المستخدمة', overage: 'سعر الساعات الإضافية', capacity: 'الساعات المحجوزة أسبوعياً',
    rollovers: { none: 'بدون ترحيل', hours: (n: number) => `حتى ${n} ساعة`, months: (n: number) => `حتى ${n} أشهر` }, unusedText: { charge: 'تُفوتر في نهاية الشهر', forfeit: 'تنتهي دون رسوم' },
    fees: (s: number, p: number, v: number) => `الفوترة عبر المنصة: الجداول الزمنية المعتمدة × السعر المتفق عليه + ${s} % رسوم المنصة + ${p} % رسوم الدفع + ${v} % ضريبة القيمة المضافة. تتبع الدفعات للاستشاري قواعد المنصة.`,
    sla: 'مستويات الخدمة (SLA)', slaDefault: 'اتفاقية مستوى الخدمة الافتراضية للمنصة', nda: 'اتفاقية عدم الإفصاح مطلوبة', yes: 'نعم', no: 'لا',
    terms: 'شروط المنصة',
    clauses: [
      'الاستشاري متعاقد مستقل، ولا تنشئ هذه الاتفاقية أي علاقة عمل. كل طرف مسؤول عن ضرائبه.',
      'AI Support 360 سوق إلكتروني وميسّر للفوترة، وليست طرفاً في العمل الاستشاري.',
      'يبقى العمل والمدفوعات ضمن النطاق المشمول على المنصة طوال مدة هذه الاتفاقية والمدة المذكورة في شروط المنصة.',
      'تبقى بيانات التواصل مخفية وفق قواعد المنصة، وتخضع السرية لاتفاقية عدم الإفصاح بين الطرفين.',
      'يتطلب تغيير السعر موافقة الطرف الآخر ويسري من تاريخ مستقبلي فقط، ولا يسري بأثر رجعي.',
      'يجوز لأي طرف إنهاء الاتفاقية بفترة الإشعار المذكورة مع ذكر السبب، وتنطبق فترة تسليم.',
    ],
    acceptance: 'القبول الإلكتروني', party: 'الطرف', name: 'الاسم المكتوب', at: 'وقت القبول', noAcc: 'لم يتم القبول بعد.',
    footer: 'أُنشئ على AI Support 360. يعكس هذا الملخص الإصدار المبيّن أعلاه.', page: (a: number, b: number) => `صفحة ${a} من ${b}`,
  },
} as const;

const fmt = (iso: string | null | undefined, lang: Lang) => {
  if (!iso) return '—';
  const ms = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(iso.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'UTC' }).format(new Date(ms)) : '—';
};

export function buildAgreementPdf(JsPDF: JsPdfCtor, a: AgreementPdfInput, lang: Lang, fonts: BrdPdfFonts): jsPDF {
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS(`${FONT}-Regular.ttf`, fonts.regular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  const t = L[lang];
  const base = lang === 'ar' ? 'rtl' : 'ltr';
  const w = new Writer(doc);
  const row = (k: string, v: string) => [plain(k, { bold: true }), plain(v || '—')];
  const tr = a.terms;

  w.paragraph(plain(t.title), { base, size: 20, bold: true, color: C.brand, gapAfter: 2 });
  w.paragraph(plain(a.name), { base, size: 13, color: C.accent, gapAfter: 8 });
  if (a.legalDraft) w.paragraph(plain(t.draft, { mark: true }), { base, size: 11, bold: true, gapAfter: 8 });
  w.table([0.34, 0.66], null, [
    row(t.version, String(a.version)), row(t.hash, a.hash ?? '—'), row(t.status, a.status),
  ], base);

  w.heading(t.parties, base, 2);
  w.table([0.34, 0.66], null, [row(t.client, a.clientName), row(t.consultant, a.consultantName ?? '—'), row(t.platform, t.platformName)], base);

  w.heading(t.scope, base, 2);
  w.table([0.34, 0.66], null, [
    row(t.modules, tr.scope.modules.join(', ')), row(t.versions, tr.scope.versions.join(', ')), row(t.systems, tr.scope.systems.join(', ')),
    row(t.covered, tr.scope.covered), row(t.notCovered, tr.scope.not_covered),
  ], base);

  w.heading(t.term, base, 2);
  w.table([0.34, 0.66], null, [
    row(t.start, fmt(tr.term.start_date, lang)), row(t.end, tr.term.end_date ? fmt(tr.term.end_date, lang) : t.openEnded),
    row(t.notice, `${tr.term.notice_days} ${t.days}`), row(t.renewal, tr.term.auto_renew ? t.autoRenew(tr.term.renew_months) : t.manual),
  ], base);

  w.heading(t.money, base, 2);
  const cur = tr.rate.currency;
  const rows = [row(t.model, t.models[tr.model]), row(t.rate, `${tr.rate.hourly_rate} ${cur}`)];
  if (tr.rate.s1_multiplier) rows.push(row(t.s1, `x ${tr.rate.s1_multiplier}`));
  if (tr.rate.ooh_multiplier) rows.push(row(t.ooh, `x ${tr.rate.ooh_multiplier}`));
  if (tr.model === 'hours_bank' && tr.bank) {
    rows.push(row(t.bank, String(tr.bank.hours_per_month)));
    rows.push(row(t.rollover, tr.bank.rollover === 'none' ? t.rollovers.none : tr.bank.rollover === 'hours' ? t.rollovers.hours(tr.bank.rollover_hours) : t.rollovers.months(tr.bank.rollover_months)));
    rows.push(row(t.unused, t.unusedText[tr.bank.unused]));
    rows.push(row(t.overage, tr.bank.overage_rate ? `${tr.bank.overage_rate} ${cur}` : `${tr.rate.hourly_rate} ${cur}`));
  }
  if (tr.model === 'availability') rows.push(row(t.capacity, String(tr.capacity_hours_per_week ?? '—')));
  w.table([0.34, 0.66], null, rows, base);
  if (a.fees) w.paragraph(plain(t.fees(a.fees.service_fee_percent, a.fees.processing_fee_percent, a.fees.vat_percent)), { base, size: 9.5, color: C.muted });

  w.heading(t.sla, base, 2);
  w.paragraph(plain(tr.sla.summary || t.slaDefault), { base });
  w.paragraph(plain(`${t.nda}: ${tr.nda_required ? t.yes : t.no}`), { base, size: 9.5, color: C.muted });

  w.heading(t.terms, base, 2);
  t.clauses.forEach((c, i) => w.paragraph(plain(c), { base, indent: 18, bullet: `${i + 1}.`, gapAfter: 3 }));

  w.heading(t.acceptance, base, 2);
  const acc = a.acceptances.filter((x) => x.version === a.version);
  if (!acc.length) w.paragraph(plain(t.noAcc), { base, color: C.muted });
  else w.table([0.2, 0.3, 0.25, 0.25], [plain(t.party), plain(t.name), plain(t.at), plain(t.hash)], acc.map((x) => [plain(x.party), plain(x.name), plain(fmt(x.at, lang)), plain(x.hash.slice(0, 16))]), base, 8.5);

  const pages = doc.getNumberOfPages();
  const footer = `${t.footer} ${fmt((a.generatedAt ?? new Date()).toISOString(), lang)}`;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fw = new Writer(doc);
    fw.y = H - 46;
    fw.paragraph(plain(`${footer}  ·  ${t.page(p, pages)}`), { base, size: 8, color: C.muted, x: ML, width: CW, gapAfter: 0 });
  }
  return doc;
}

export async function agreementPdfBlob(a: AgreementPdfInput, lang: Lang): Promise<Blob> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  return buildAgreementPdf(jsPDF as unknown as JsPdfCtor, a, lang, fonts).output('blob');
}

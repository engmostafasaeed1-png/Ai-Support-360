// "Agreement summary" PDF (one terms version): parties, scope, term, rate, hours model, SLA snapshot, notice, renewal,
// platform terms and the electronic acceptance record with the version hash. Built in the browser with the shared
// bilingual PDF writer of the BRD (same embedded IBM Plex Sans Arabic font and bidi layout).
import type { jsPDF } from 'jspdf';
import { C, CW, FONT, H, ML, plain, Writer, loadBrdFonts, type BrdPdfFonts, type JsPdfCtor } from '@/lib/brd/pdf';
import type { SaTerms } from './model';

type Lang = 'en' | 'ar';

export interface AgreementPdfInput {
  name: string;
  reference?: string | null;
  crew?: Array<{ name: string; role: string; capacity: number | null; required: boolean; status: string; slaAt: string | null; ndaAt: string | null }>;
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
    reference: 'Reference', crew: 'Support crew', member: 'Member', role: 'Role', hoursWeek: 'Hours / week', slaAccepted: 'SLA accepted', ndaSigned: 'NDA signed', optional: 'optional',
    slaTitle: 'SLA snapshot', slaNote: 'Exact SLA version agreed with this support agreement. It applies to tickets under the agreement only while the agreement is active (crew confirmed).',
    sev: 'Severity', response: 'Response', workaround: 'Workaround', resolution: 'Resolution', coverage: 'Coverage', policy: 'Policy',
    statementTitle: 'Monthly statement', month: 'Month', used: 'Approved hours', committed: 'Committed hours', expired: 'Expired hours', charged: 'Hours invoiced', amount: 'Amount (before fees and VAT)',
    tickets: 'Tickets', slaCompliance: 'SLA compliance', spend: 'Spend to date (paid)',
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
    reference: 'الرقم المرجعي', crew: 'فريق الدعم', member: 'العضو', role: 'الدور', hoursWeek: 'ساعات / أسبوع', slaAccepted: 'قبول اتفاقية الخدمة', ndaSigned: 'توقيع عدم الإفصاح', optional: 'اختياري',
    slaTitle: 'نسخة اتفاقية مستوى الخدمة', slaNote: 'الإصدار المحدد من اتفاقية مستوى الخدمة المتفق عليه مع اتفاقية الدعم هذه. يسري على تذاكر الاتفاقية فقط طالما كانت الاتفاقية نشطة (بعد تأكيد الفريق).',
    sev: 'الخطورة', response: 'الاستجابة', workaround: 'الحل المؤقت', resolution: 'الحل', coverage: 'التغطية', policy: 'السياسة',
    statementTitle: 'الكشف الشهري', month: 'الشهر', used: 'الساعات المعتمدة', committed: 'الساعات الملتزم بها', expired: 'الساعات المنتهية', charged: 'الساعات المفوترة', amount: 'المبلغ (قبل الرسوم والضريبة)',
    tickets: 'التذاكر', slaCompliance: 'الالتزام باتفاقية الخدمة', spend: 'الإنفاق حتى الآن (مدفوع)',
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
    row(t.reference, a.reference ?? '—'), row(t.version, String(a.version)), row(t.hash, a.hash ?? '—'), row(t.status, a.status),
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

  if (a.crew?.length) {
    w.heading(t.crew, base, 2);
    w.table([0.26, 0.18, 0.12, 0.22, 0.22], [plain(t.member), plain(t.role), plain(t.hoursWeek), plain(t.slaAccepted), plain(t.ndaSigned)],
      a.crew.map((m) => [plain(m.required ? m.name : `${m.name} (${t.optional})`), plain(m.role), plain(m.capacity != null ? String(m.capacity) : '—'), plain(fmt(m.slaAt, lang)), plain(fmt(m.ndaAt, lang))]), base, 8.5);
  }

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

function setup(JsPDF: JsPdfCtor, fonts: BrdPdfFonts) {
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS(`${FONT}-Regular.ttf`, fonts.regular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  return doc;
}
function footer(doc: jsPDF, lang: Lang, at: Date) {
  const t = L[lang]; const base = lang === 'ar' ? 'rtl' : 'ltr';
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fw = new Writer(doc);
    fw.y = H - 46;
    fw.paragraph(plain(`${t.footer} ${fmt(at.toISOString(), lang)}  ·  ${t.page(p, pages)}`), { base, size: 8, color: C.muted, x: ML, width: CW, gapAfter: 0 });
  }
}
const mins = (m: unknown) => {
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 60) return `${n} min`;
  if (n % 1440 === 0) return `${n / 1440} d`;
  return n % 60 === 0 ? `${n / 60} h` : `${Math.floor(n / 60)} h ${n % 60} min`;
};

/** The SLA version the agreement was agreed with (immutable snapshot in the terms). */
export interface SlaSnapshotPdfInput { name: string; reference?: string | null; sla: SaTerms['sla']; legalDraft: boolean }
export function buildSlaSnapshotPdf(JsPDF: JsPdfCtor, a: SlaSnapshotPdfInput, lang: Lang, fonts: BrdPdfFonts): jsPDF {
  const doc = setup(JsPDF, fonts); const t = L[lang]; const base = lang === 'ar' ? 'rtl' : 'ltr'; const w = new Writer(doc);
  const row = (k: string, v: string) => [plain(k, { bold: true }), plain(v || '—')];
  w.paragraph(plain(t.slaTitle), { base, size: 20, bold: true, color: C.brand, gapAfter: 2 });
  w.paragraph(plain(`${a.name}${a.reference ? ` · ${a.reference}` : ''}`), { base, size: 13, color: C.accent, gapAfter: 8 });
  if (a.legalDraft) w.paragraph(plain(t.draft, { mark: true }), { base, size: 11, bold: true, gapAfter: 8 });
  w.table([0.34, 0.66], null, [row(t.policy, a.sla.name ?? t.slaDefault), row(t.version, a.sla.version ? String(a.sla.version) : '—'), row(t.hash, a.sla.hash ?? '—')], base);
  w.paragraph(plain(t.slaNote), { base, size: 9.5, color: C.muted });
  const body = (a.sla.body ?? null) as { severities?: Record<string, { response_min?: number; workaround_min?: number | null; resolution_min?: number }>; coverage?: { mode?: string } } | null;
  if (body?.severities) {
    w.table([0.16, 0.28, 0.28, 0.28], [plain(t.sev), plain(t.response), plain(t.workaround), plain(t.resolution)],
      ['S1', 'S2', 'S3', 'S4'].filter((k) => body.severities?.[k]).map((k) => [plain(k), plain(mins(body.severities![k].response_min)), plain(mins(body.severities![k].workaround_min)), plain(mins(body.severities![k].resolution_min))]), base, 9);
    if (body.coverage?.mode) w.paragraph(plain(`${t.coverage}: ${body.coverage.mode}`), { base, size: 9.5, color: C.muted });
  } else {
    w.paragraph(plain(a.sla.summary || t.slaDefault), { base });
  }
  footer(doc, lang, new Date());
  return doc;
}

/** Monthly statement (usage dashboard figures; invoices themselves stay the platform invoices). */
export interface StatementPdfInput {
  name: string; reference?: string | null; clientName: string; consultantName: string | null; currency: string; legalDraft: boolean;
  months: Array<{ month: string; used_hours: number; committed?: number | null; expired_hours?: number | null; charge_hours?: number | null; amount?: number | null }>;
  tickets: number; slaPct: number | null; spend: number;
}
export function buildStatementPdf(JsPDF: JsPdfCtor, a: StatementPdfInput, lang: Lang, fonts: BrdPdfFonts): jsPDF {
  const doc = setup(JsPDF, fonts); const t = L[lang]; const base = lang === 'ar' ? 'rtl' : 'ltr'; const w = new Writer(doc);
  const row = (k: string, v: string) => [plain(k, { bold: true }), plain(v || '—')];
  w.paragraph(plain(t.statementTitle), { base, size: 20, bold: true, color: C.brand, gapAfter: 2 });
  w.paragraph(plain(`${a.name}${a.reference ? ` · ${a.reference}` : ''}`), { base, size: 13, color: C.accent, gapAfter: 8 });
  w.table([0.34, 0.66], null, [row(t.client, a.clientName), row(t.consultant, a.consultantName ?? '—'), row(t.tickets, String(a.tickets)),
    row(t.slaCompliance, a.slaPct == null ? '—' : `${a.slaPct} %`), row(t.spend, `${a.spend} ${a.currency}`)], base);
  w.table([0.2, 0.16, 0.16, 0.16, 0.16, 0.16], [plain(t.month), plain(t.used), plain(t.committed), plain(t.expired), plain(t.charged), plain(t.amount)],
    a.months.map((m) => [plain(m.month.slice(0, 7)), plain(String(m.used_hours)), plain(m.committed != null ? String(m.committed) : '—'), plain(m.expired_hours != null ? String(m.expired_hours) : '—'),
      plain(m.charge_hours != null ? String(m.charge_hours) : '—'), plain(m.amount ? `${m.amount} ${a.currency}` : '—')]), base, 8.5);
  footer(doc, lang, new Date());
  return doc;
}

export async function slaSnapshotPdfBlob(a: SlaSnapshotPdfInput, lang: Lang): Promise<Blob> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  return buildSlaSnapshotPdf(jsPDF as unknown as JsPdfCtor, a, lang, fonts).output('blob');
}
export async function statementPdfBlob(a: StatementPdfInput, lang: Lang): Promise<Blob> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  return buildStatementPdf(jsPDF as unknown as JsPdfCtor, a, lang, fonts).output('blob');
}

export async function agreementPdfBlob(a: AgreementPdfInput, lang: Lang): Promise<Blob> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  return buildAgreementPdf(jsPDF as unknown as JsPdfCtor, a, lang, fonts).output('blob');
}

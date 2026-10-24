// Sample BRDs (English and Arabic) for the owner to judge the layout; rendered into docs/ by build.ts and used by the
// empty-state preview. Invented example content, clearly labelled as a sample.
import { emptyContent, normalizeContent, type BrdContent, type VersionMeta } from '../../supabase/functions/_shared/brdModel';

const T = (s: string) => `<mark data-tbc="1">${s}</mark>`;

export function sampleBrd(lang: 'en' | 'ar'): BrdContent {
  const c = emptyContent({
    language: lang, template: 'standard', ticketRef: 'SAMPLE01',
    title: lang === 'ar' ? 'منع حجب فواتير MIRO بعد الترقية إلى S/4HANA 2023' : 'Stop MIRO invoice blocks after the S/4HANA 2023 upgrade',
    company: lang === 'ar' ? 'شركة مثال للتجارة (عينة)' : 'Example Trading Co. (sample)',
    requester: lang === 'ar' ? 'مدير الحسابات الدائنة' : 'Accounts payable manager',
    date: '2026-10-24',
  });
  c.control.approvers = lang === 'ar' ? 'المدير المالي؛ قائد فريق SAP' : 'Finance director; SAP team lead';
  const en: Record<string, string> = {
    purpose: '<p>Since the upgrade to SAP S/4HANA 2023 (FPS01) on 12 October, about 40% of vendor invoices posted with MIRO are blocked for payment with reason "price variance", although the purchase order price and the invoice price match.</p><p>This document describes what the business needs so a consultant can find the cause and fix it.</p>',
    objectives: '<ul><li>Invoices whose price matches the purchase order are no longer blocked (target: fewer than 2% blocked for price).</li><li>Blocked invoices from October are released without manual re-posting.</li><li>Month-end close on ' + T('To be confirmed: closing date for October') + ' is not delayed.</li></ul>',
    scope: '<h4>In scope</h4><ul><li>Invoice verification (MIRO, MRBR) for company codes 1000 and 2000.</li><li>Tolerance keys PP and PS.</li></ul><h4>Out of scope</h4><ul><li>Changes to the purchasing approval workflow.</li><li>Freight invoices posted in transaction MRKO.</li></ul>',
    current_future: '<p><strong>AS-IS:</strong> invoices are blocked with block reason R; the AP team releases them one by one in MRBR (about 3 hours per day).</p><p><strong>TO-BE:</strong> only invoices with a real price difference above tolerance are blocked; the others are posted free for payment.</p>',
    stakeholders: '<table><tr><th>Role</th><th>Responsibility</th></tr><tr><td>AP manager (requester)</td><td>Confirms the business rules and tests</td></tr><tr><td>Procurement lead</td><td>Confirms purchase order price conditions</td></tr><tr><td>SAP consultant</td><td>Analysis, fix, transport</td></tr></table>',
    functional: '<p>The requirements below must be met before the change is accepted.</p>',
    non_functional: '<ul><li>Audit: every change of tolerance settings is recorded in the change log of the configuration transport.</li><li>Performance: MIRO posting time stays below 3 seconds.</li></ul>',
    sap_landscape: '<ul><li>System: SAP S/4HANA 2023 FPS01, on-premise; landscape DEV → QAS → PRD.</li><li>Modules: MM-IV, FI-AP.</li><li>Integrations: ' + T('To be confirmed: is the OCR invoice inbound interface involved?') + '</li></ul>',
    data_migration: '<p>No data migration. Blocked invoices from October (about 1,200) must be re-checked with the corrected rules.</p>',
    assumptions: '<ul><li>The issue started with the upgrade; no tolerance key was changed by the business.</li><li>Test data can be copied to QAS.</li></ul>',
    risks: '<table><tr><th>Risk</th><th>Mitigation</th></tr><tr><td>Releasing invoices that really have a price difference</td><td>Run the re-check in QAS first and review the list with AP</td></tr><tr><td>Month-end delay</td><td>Fix before ' + T('To be confirmed: date') + '</td></tr></table>',
    testing: '<ol><li>Unit test in DEV with 10 sample purchase orders.</li><li>UAT in QAS by the AP team with 50 real invoices (price matching, above and below tolerance).</li><li>Sign-off by the AP manager.</li></ol>',
    timeline: '<p>Urgency: high. Target: fix in production within 5 working days.</p>',
    open_questions: '<ul><li>Which exact SAP Notes were already tried?</li><li>' + T('To be confirmed: are planned delivery costs part of the price check?') + '</li></ul>',
    attachments: '<ul><li>Screenshot of the MRBR list (attached to the ticket)</li><li>Tolerance settings export (OMR6)</li></ul>',
  };
  const ar: Record<string, string> = {
    purpose: '<p>منذ الترقية إلى SAP S/4HANA 2023 (FPS01) في 12 أكتوبر، يُحجب نحو 40% من فواتير الموردين المرحّلة عبر MIRO عن الدفع بسبب "فرق السعر"، مع أن سعر أمر الشراء يطابق سعر الفاتورة.</p><p>توضح هذه الوثيقة احتياجات العمل حتى يتمكن الاستشاري من تحديد السبب وإصلاحه.</p>',
    objectives: '<ul><li>لا تُحجب الفواتير التي يطابق سعرها أمر الشراء (الهدف: أقل من 2% محجوبة بسبب السعر).</li><li>تحرير فواتير أكتوبر المحجوبة دون إعادة ترحيل يدوية.</li><li>عدم تأخير إقفال نهاية الشهر في ' + T('يُؤكَّد لاحقاً: تاريخ إقفال أكتوبر') + '.</li></ul>',
    scope: '<h4>داخل النطاق</h4><ul><li>التحقق من الفواتير (MIRO و MRBR) لرمزي الشركة 1000 و 2000.</li><li>مفاتيح السماح PP و PS.</li></ul><h4>خارج النطاق</h4><ul><li>تغيير مسار اعتماد المشتريات.</li><li>فواتير الشحن المرحّلة عبر MRKO.</li></ul>',
    current_future: '<p><strong>الوضع الحالي:</strong> تُحجب الفواتير برمز الحجب R، ويحررها فريق الحسابات الدائنة واحدة تلو الأخرى في MRBR (نحو 3 ساعات يومياً).</p><p><strong>الوضع المطلوب:</strong> تُحجب فقط الفواتير التي بها فرق سعر حقيقي يتجاوز حد السماح.</p>',
    stakeholders: '<table><tr><th>الدور</th><th>المسؤولية</th></tr><tr><td>مدير الحسابات الدائنة (مقدم الطلب)</td><td>يؤكد قواعد العمل والاختبارات</td></tr><tr><td>قائد المشتريات</td><td>يؤكد شروط أسعار أوامر الشراء</td></tr><tr><td>استشاري SAP</td><td>التحليل والإصلاح والنقل</td></tr></table>',
    functional: '<p>يجب استيفاء المتطلبات التالية قبل قبول التغيير.</p>',
    non_functional: '<ul><li>التدقيق: يُسجّل كل تغيير في إعدادات السماح ضمن سجل النقل.</li><li>الأداء: يبقى زمن الترحيل في MIRO أقل من 3 ثوانٍ.</li></ul>',
    sap_landscape: '<ul><li>النظام: SAP S/4HANA 2023 FPS01 محلياً؛ البيئات DEV ثم QAS ثم PRD.</li><li>الوحدات: MM-IV و FI-AP.</li><li>التكاملات: ' + T('يُؤكَّد لاحقاً: هل واجهة الفواتير الضوئية (OCR) معنية؟') + '</li></ul>',
    data_migration: '<p>لا يوجد ترحيل بيانات. يجب إعادة فحص فواتير أكتوبر المحجوبة (نحو 1,200 فاتورة) بالقواعد المصححة.</p>',
    assumptions: '<ul><li>بدأت المشكلة مع الترقية، ولم يغيّر فريق العمل أي مفتاح سماح.</li><li>يمكن نسخ بيانات الاختبار إلى QAS.</li></ul>',
    risks: '<table><tr><th>الخطر</th><th>إجراء التخفيف</th></tr><tr><td>تحرير فواتير بها فرق سعر فعلي</td><td>تنفيذ إعادة الفحص في QAS أولاً ومراجعة القائمة مع الفريق</td></tr><tr><td>تأخر إقفال الشهر</td><td>الإصلاح قبل ' + T('يُؤكَّد لاحقاً: التاريخ') + '</td></tr></table>',
    testing: '<ol><li>اختبار وحدة في DEV باستخدام 10 أوامر شراء.</li><li>اختبار قبول المستخدم (UAT) في QAS بخمسين فاتورة حقيقية.</li><li>اعتماد مدير الحسابات الدائنة.</li></ol>',
    timeline: '<p>درجة الاستعجال: عالية. الهدف: الإصلاح في بيئة الإنتاج خلال 5 أيام عمل.</p>',
    open_questions: '<ul><li>ما ملاحظات SAP (SAP Notes) التي جُرّبت بالفعل؟</li><li>' + T('يُؤكَّد لاحقاً: هل تدخل تكاليف التسليم المخططة في فحص السعر؟') + '</li></ul>',
    attachments: '<ul><li>لقطة شاشة لقائمة MRBR (مرفقة بالتذكرة)</li><li>تصدير إعدادات السماح (OMR6)</li></ul>',
  };
  const src = lang === 'ar' ? ar : en;
  c.sections = c.sections.map((s) => ({ ...s, html: src[s.key] ?? '' }));
  c.requirements = lang === 'ar'
    ? [
      { id: '', description: 'يقارن النظام سعر الفاتورة بسعر أمر الشراء الصافي بعد الخصومات.', priority: 'must', status: 'agreed', owner: 'استشاري SAP', acceptance: 'فاتورة بسعر مطابق تُرحّل دون حجب في 50 حالة اختبار.' },
      { id: '', description: 'تبقى الحجوزات قائمة لفروق السعر التي تتجاوز 2% أو 500 ريال.', priority: 'must', status: 'proposed', owner: 'الحسابات الدائنة', acceptance: 'فاتورة بفرق 3% تُحجب برمز R.' },
      { id: '', description: 'تقرير بفواتير أكتوبر المحجوبة التي يمكن تحريرها تلقائياً.', priority: 'should', status: 'proposed', owner: 'استشاري SAP', acceptance: 'قائمة يراجعها مدير الحسابات الدائنة ويعتمدها.' },
    ]
    : [
      { id: '', description: 'The system compares the invoice price with the net purchase order price after discounts.', priority: 'must', status: 'agreed', owner: 'SAP consultant', acceptance: 'An invoice with a matching price posts without a block in 50 test cases.' },
      { id: '', description: 'Blocks remain for price differences above 2% or SAR 500.', priority: 'must', status: 'proposed', owner: 'Accounts payable', acceptance: 'An invoice 3% above the PO price is blocked with reason R.' },
      { id: '', description: 'A report lists October invoices that can be released automatically.', priority: 'should', status: 'proposed', owner: 'SAP consultant', acceptance: 'The list is reviewed and approved by the AP manager.' },
    ];
  return normalizeContent(c);
}

export const sampleVersions: VersionMeta[] = [
  { version: 1, status: 'draft', change_note: 'First draft from the ticket', created_at: '2026-10-22T09:00:00Z', author: 'Client' },
  { version: 2, status: 'draft', change_note: 'Answered the open questions about company codes', created_at: '2026-10-23T11:30:00Z', author: 'Client' },
  { version: 3, status: 'final', change_note: 'Approved for the consultant', created_at: '2026-10-24T08:15:00Z', author: 'Client' },
];

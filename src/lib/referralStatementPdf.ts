import jsPDF from 'jspdf';
import { formatRate, type CalcLine } from './referrals';

export interface StatementData {
  title: string;
  period: string;
  consultantCode: string;
  generatedAt: string;
  summary: Array<[string, string]>;
  lines: CalcLine[];
  lang: 'en' | 'ar';
}

const ARABIC = /[\u0600-\u06FF]/;
const money = (v: number | null | undefined, cur = 'USD') => {
  if (v == null) return '-';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(v); } catch { return `${v.toFixed(2)} ${cur}`; }
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '-');

/** Statement of the consultant's own referral lines. English: real PDF; Arabic text: the browser's print-to-PDF keeps the shaping. */
export function exportReferralStatementPdf(d: StatementData): void {
  const needsPrint = d.lang === 'ar' || d.lines.some((l) => ARABIC.test(l.referred_name ?? '')) || d.summary.some(([a, b]) => ARABIC.test(a + b));
  if (needsPrint) { printStatement(d); return; }
  const doc = new jsPDF({ orientation: 'landscape' });
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(d.title, 14, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${d.period}  |  Code ${d.consultantCode}  |  Generated ${d.generatedAt}`, 14, 23);
  let y = 31;
  d.summary.forEach(([k, v], i) => { doc.text(`${k}: ${v}`, 14 + (i % 3) * 90, y + Math.floor(i / 3) * 5); });
  y += Math.ceil(d.summary.length / 3) * 5 + 6;
  const cols = ['Date', 'Referred', 'Ticket', 'Hours', 'Man-days', 'Rate/h', 'Fee', 'Formula', 'Reward', 'State'];
  const x = [14, 36, 62, 84, 100, 118, 138, 162, 238, 262];
  const header = () => { doc.setFont('helvetica', 'bold'); cols.forEach((c, i) => doc.text(c, x[i], y)); doc.setFont('helvetica', 'normal'); y += 5; };
  header();
  for (const l of d.lines) {
    if (y > 195) { doc.addPage(); y = 16; header(); }
    const formula = l.kind === 'reward' && l.fee_amount != null
      ? `${money(l.fee_amount, l.currency)} x ${formatRate(Number(l.rate_percent) || 0)} %`
      : l.kind === 'reversal' ? 'Reversal' : 'Adjustment';
    const cells = [day(l.created_at), l.referred_name ?? '-', l.ticket_ref ?? '-', l.approved_hours == null ? '-' : String(l.approved_hours),
      l.man_days == null ? '-' : String(l.man_days), l.hourly_rate == null ? '-' : money(l.hourly_rate, l.currency), money(l.fee_amount, l.currency),
      formula, money(l.amount, l.currency), l.status];
    cells.forEach((c, i) => doc.text(String(c).slice(0, i === 7 ? 40 : 18), x[i], y));
    y += 5;
  }
  doc.setFontSize(7);
  doc.text('Computed by AI Support 360 from paid invoices. Rewards are paid by the platform and never deducted from the referred consultant.', 14, 205);
  doc.text(`Page count: ${doc.getNumberOfPages()}`, w - 40, 205);
  doc.save(`referral-statement-${d.period.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}

function printStatement(d: StatementData) {
  const page = window.open('', '_blank');
  if (!page) return;
  const rtl = d.lang === 'ar';
  const rows = d.lines.map((l) => `<tr><td>${day(l.created_at)}</td><td><bdi>${esc(l.referred_name ?? '-')}</bdi></td><td>${esc(l.ticket_ref ?? '-')}</td>
    <td>${l.approved_hours ?? '-'}</td><td>${l.man_days ?? '-'}</td><td>${money(l.hourly_rate, l.currency)}</td><td>${money(l.fee_amount, l.currency)}</td>
    <td dir="ltr">${l.kind === 'reward' && l.fee_amount != null ? `${money(l.fee_amount, l.currency)} x ${formatRate(Number(l.rate_percent) || 0)} % = ${money(l.amount, l.currency)}` : esc(l.kind)}</td>
    <td>${money(l.amount, l.currency)}</td><td>${esc(l.status)}</td></tr>`).join('');
  const head = rtl
    ? ['التاريخ', 'المستشار المُحال', 'التذكرة', 'الساعات', 'أيام العمل', 'السعر/ساعة', 'الأتعاب', 'المعادلة', 'المكافأة', 'الحالة']
    : ['Date', 'Referred', 'Ticket', 'Hours', 'Man-days', 'Rate/h', 'Fee', 'Formula', 'Reward', 'State'];
  page.document.write(`<!doctype html><html lang="${d.lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
    @page{size:A4 landscape;margin:12mm}body{font:9pt Tahoma,Arial,sans-serif;color:#0f172a}h1{font-size:15pt;margin:0 0 4px}
    .meta{color:#475569;margin-bottom:8px}.sum{display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0 12px}table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:start}th{background:#f1f5f9}</style></head><body>
    <h1>${esc(d.title)}</h1><div class="meta">${esc(d.period)} | ${esc(d.consultantCode)} | ${esc(d.generatedAt)}</div>
    <div class="sum">${d.summary.map(([k, v]) => `<div><b>${esc(k)}:</b> <bdi>${esc(v)}</bdi></div>`).join('')}</div>
    <table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
  page.document.close(); page.focus(); setTimeout(() => page.print(), 300);
}

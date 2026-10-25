// Signed NDA PDF: the existing NDA text unchanged, then one signature block per party with the free-hand signature
// image, printed name, masked ID (type + country), date/time (UTC), role, company, method and fingerprints, the
// document version hash and the footer "Electronically signed in the AI Support 360 portal. Not a qualified electronic
// signature." on every page. Built with the shared bilingual writer of the BRD (embedded IBM Plex Sans Arabic, bidi
// per line), so Arabic text and an Arabic interface never break the layout. Pure builder (no fetch) for tests.
import type { jsPDF } from 'jspdf';
import { C, CW, H, ML, plain, Writer, loadBrdFonts, FONT, type BrdPdfFonts, type JsPdfCtor } from '@/lib/brd/pdf';
import { NDA_PDF_FOOTER, type NdaEvidence } from '../../../supabase/functions/_shared/ndaSignature';

type Lang = 'en' | 'ar';
type Base = 'ltr' | 'rtl';

export interface NdaPdfParty {
  signedAt: string | null;
  /** PNG data URL of the drawn (or rendered typed) signature. */
  image: string | null;
  /** Legacy typed signature text. */
  typed: string | null;
  name: string;
  company?: string | null;
  evidence: NdaEvidence | null;
  /** Signed before identity details were collected. */
  legacy: boolean;
}

export interface NdaPdfInput {
  ndaId?: string | null;
  content: string;
  consultantName: string;
  clientName: string;
  consultant: NdaPdfParty;
  client: NdaPdfParty;
  documentHash?: string | null;
  revokedAt?: string | null;
  generatedAt?: Date;
}

const L = {
  en: {
    title: 'Non-Disclosure Agreement', between: (a: string, b: string) => `${a} and ${b}`,
    full: 'Fully signed by both parties', waiting: (r: string) => `Waiting for the ${r} to sign`, draft: 'Draft - not signed yet', revoked: (d: string) => `Revoked on ${d}`,
    signatures: 'Signatures', consultant: 'Consultant (receiving party)', client: 'Client (disclosing party)', roleC: 'consultant', roleK: 'client',
    name: 'Printed name', id: 'ID document', at: 'Signed at (UTC)', role: 'Role', company: 'Company', title: 'Job title', method: 'Method',
    drawn: 'Free-hand electronic signature', typedM: 'Typed electronic signature', legacy: 'Signed (legacy signature, no ID collected)',
    notSigned: 'Not signed yet', sigHash: 'Signature fingerprint (SHA-256)', docHash: 'Document version hash (SHA-256)', ref: 'NDA reference',
    types: { passport: 'Passport', national_id: 'National ID' } as Record<string, string>, details: 'Identity details added later on', page: (a: number, b: number) => `Page ${a} of ${b}`,
  },
  ar: {
    title: 'اتفاقية عدم الإفصاح', between: (a: string, b: string) => `${a} و ${b}`,
    full: 'موقعة بالكامل من الطرفين', waiting: (r: string) => `بانتظار توقيع ${r}`, draft: 'مسودة - غير موقعة بعد', revoked: (d: string) => `أُلغيت في ${d}`,
    signatures: 'التوقيعات', consultant: 'الاستشاري (الطرف المتلقي)', client: 'العميل (الطرف المفصح)', roleC: 'الاستشاري', roleK: 'العميل',
    name: 'الاسم', id: 'وثيقة الهوية', at: 'وقت التوقيع (UTC)', role: 'الصفة', company: 'الشركة', title: 'المسمى الوظيفي', method: 'الطريقة',
    drawn: 'توقيع إلكتروني بخط اليد', typedM: 'توقيع إلكتروني مكتوب', legacy: 'موقّعة (توقيع سابق، دون بيانات هوية)',
    notSigned: 'لم يوقّع بعد', sigHash: 'بصمة التوقيع (SHA-256)', docHash: 'بصمة إصدار المستند (SHA-256)', ref: 'مرجع الاتفاقية',
    types: { passport: 'جواز سفر', national_id: 'هوية وطنية' } as Record<string, string>, details: 'أضيفت بيانات الهوية لاحقًا في', page: (a: number, b: number) => `صفحة ${a} من ${b}`,
  },
};

const AR = /[\u0600-\u06FF]/;
const lineBase = (s: string, fallback: Base): Base => (AR.test(s) ? 'rtl' : /[A-Za-z]/.test(s) ? 'ltr' : fallback);
const utc = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') : '—');

export function idLine(e: Pick<NdaEvidence, 'id_type' | 'id_country' | 'id_masked'> | null, lang: Lang): string {
  if (!e) return '—';
  return `${L[lang].types[e.id_type] ?? e.id_type} · ${e.id_country} · ${e.id_masked}`;
}

/** Text lines of one party's signature block (also used by tests: masked ID only, never a full number). */
export function partyRows(p: NdaPdfParty, role: 'consultant' | 'client', lang: Lang): Array<[string, string]> {
  const t = L[lang];
  const e = p.evidence;
  const rows: Array<[string, string]> = [
    [t.name, e?.signer_name || p.name || '—'],
    [t.role, role === 'consultant' ? t.roleC : t.roleK],
  ];
  if (role === 'client' || e?.company_name) rows.push([t.company, e?.company_name || p.company || '—']);
  if (e?.job_title) rows.push([t.title, e.job_title]);
  rows.push([t.at, p.signedAt ? utc(p.signedAt) : t.notSigned]);
  if (p.signedAt) {
    rows.push([t.id, e ? idLine(e, lang) : t.legacy]);
    rows.push([t.method, e ? (e.method === 'typed' ? t.typedM : t.drawn) : p.image ? t.drawn : t.typedM]);
    if (e?.kind === 'supplement') rows.push([t.details, utc(e.captured_at)]);
    if (e?.image_sha256) rows.push([t.sigHash, e.image_sha256]);
  }
  return rows;
}

export function buildNdaPdf(JsPDF: JsPdfCtor, a: NdaPdfInput, lang: Lang, fonts: BrdPdfFonts): jsPDF {
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS(`${FONT}-Regular.ttf`, fonts.regular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  const t = L[lang];
  const base: Base = lang === 'ar' ? 'rtl' : 'ltr';
  const w = new Writer(doc);
  doc.setProperties({ title: t.title, subject: t.title, creator: 'AI Support 360', author: 'AI Support 360' });

  const both = !!a.consultant.signedAt && !!a.client.signedAt;
  const status = a.revokedAt ? t.revoked(utc(a.revokedAt)) : both ? t.full : a.consultant.signedAt ? t.waiting(t.roleK) : a.client.signedAt ? t.waiting(t.roleC) : t.draft;
  w.paragraph(plain(t.title), { base, size: 20, bold: true, color: C.brand, gapAfter: 2 });
  w.paragraph(plain(t.between(a.consultantName || t.roleC, a.clientName || t.roleK)), { base, size: 11, color: C.accent, gapAfter: 2 });
  w.paragraph(plain(status, { mark: !!a.revokedAt || !both }), { base, size: 10, bold: true, gapAfter: 10 });

  // the agreement text exactly as signed
  const fallback: Base = AR.test(a.content) && !/[A-Za-z]{20,}/.test(a.content) ? 'rtl' : 'ltr';
  for (const line of String(a.content ?? '').split(/\r?\n/)) {
    if (!line.trim()) { w.y += 5; continue; }
    w.paragraph(plain(line), { base: lineBase(line, fallback), size: 9.5, color: C.text, gapAfter: 2 });
  }

  // signatures
  if (w.room() < 260) w.newPage(); else w.y += 14;
  w.heading(t.signatures, base, 2);
  const block = (p: NdaPdfParty, role: 'consultant' | 'client') => {
    w.ensure(200);
    w.heading(role === 'consultant' ? t.consultant : t.client, base, 3);
    const boxW = 200, boxH = 66;
    const x = base === 'rtl' ? ML + CW - boxW : ML;
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, w.y, boxW, boxH, 4, 4, 'S');
    if (p.signedAt && p.image) {
      try { doc.addImage(p.image, 'PNG', x + 4, w.y + 3, boxW - 8, boxH - 6); } catch { /* unreadable image: the text record below still stands */ }
      w.y += boxH + 6;
    } else if (p.signedAt && p.typed) {
      const y0 = w.y;
      w.y += 18;
      w.paragraph(plain(p.typed), { base: lineBase(p.typed, base), size: 18, color: C.brand, x: x + 8, width: boxW - 16, gapAfter: 0 });
      w.y = y0 + boxH + 6;
    } else {
      const y0 = w.y;
      w.y += 26;
      w.paragraph(plain(t.notSigned), { base, size: 10, color: C.muted, x: x + 8, width: boxW - 16, gapAfter: 0 });
      w.y = y0 + boxH + 6;
    }
    w.table([0.36, 0.64], null, partyRows(p, role, lang).map(([k, v]) => [plain(k, { bold: true }), plain(v)]), base, 8.6);
    w.y += 6;
  };
  block(a.consultant, 'consultant');
  block(a.client, 'client');
  const meta: Array<[string, string]> = [];
  if (a.documentHash) meta.push([t.docHash, a.documentHash]);
  if (a.ndaId) meta.push([t.ref, a.ndaId]);
  if (meta.length) {
    w.ensure(60);
    w.table([0.36, 0.64], null, meta.map(([k, v]) => [plain(k, { bold: true }), plain(v)]), base, 8.4);
  }

  // footer on every page (Arabic documents carry the English sentence as well)
  const pages = doc.getNumberOfPages();
  const footer = lang === 'ar' ? `${NDA_PDF_FOOTER.ar} ${NDA_PDF_FOOTER.en}` : NDA_PDF_FOOTER.en;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fw = new Writer(doc);
    fw.y = H - 50;
    fw.paragraph(plain(`${footer}  ·  ${t.page(p, pages)}`), { base, size: 7.5, color: C.muted, x: ML, width: CW, gapAfter: 0 });
  }
  return doc;
}

export async function downloadNdaPdf(a: NdaPdfInput, lang: Lang, filename: string): Promise<void> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadBrdFonts()]);
  buildNdaPdf(jsPDF as unknown as JsPdfCtor, a, lang, fonts).save(filename);
}

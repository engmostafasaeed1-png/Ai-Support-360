// Editable exports of a BRD version: a Word-compatible document (.doc, HTML that Word, LibreOffice and Google Docs
// open and edit, right-to-left for Arabic) and Markdown. Pure string builders; the HTML is the sanitised section HTML.
import {
  SECTION_TITLES, TBC_LABEL, changeLogRows, escapeHtml, htmlToText, visibleSections,
  type BrdContent, type VersionMeta,
} from '../../../supabase/functions/_shared/brdModel';

const L = {
  en: { brd: 'Business Requirements Document', control: 'Document control', title: 'Title', ticket: 'Ticket', company: 'Client company', requester: 'Requester', date: 'Date', version: 'Version', status: 'Status', approvers: 'Approvers', draft: 'Draft', final: 'Final', id: 'ID', req: 'Requirement', priority: 'Priority', owner: 'Owner', acc: 'Acceptance criteria', by: 'By', note: 'Note', confidential: 'Confidential - shared under the NDA of this ticket', must: 'Must', should: 'Should', could: 'Could' },
  ar: { brd: 'وثيقة متطلبات الأعمال', control: 'بيانات الوثيقة', title: 'العنوان', ticket: 'التذكرة', company: 'شركة العميل', requester: 'مقدم الطلب', date: 'التاريخ', version: 'الإصدار', status: 'الحالة', approvers: 'المعتمدون', draft: 'مسودة', final: 'نهائية', id: 'المعرف', req: 'المتطلب', priority: 'الأولوية', owner: 'المسؤول', acc: 'معايير القبول', by: 'بواسطة', note: 'ملاحظة', confidential: 'سري - تمت مشاركته بموجب اتفاقية عدم الإفصاح الخاصة بهذه التذكرة', must: 'يجب', should: 'ينبغي', could: 'يمكن' },
} as const;

export function primaryLang(c: BrdContent): 'en' | 'ar' {
  return c.language === 'ar' ? 'ar' : 'en';
}

export function brdWordHtml(c: BrdContent, opts: { version: number | null; versions: VersionMeta[] }): string {
  const lang = primaryLang(c);
  const t = L[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const both = c.language === 'both';
  const row = (k: string, v: string) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(t.brd)}</h1><h2>${escapeHtml(c.control.title)}</h2>`);
  parts.push(`<h3>${t.control}</h3><table>${[
    row(t.title, c.control.title), row(t.ticket, `#${c.control.ticket_ref}`), row(t.company, c.control.company), row(t.requester, c.control.requester),
    row(t.date, c.control.date), row(t.version, opts.version ? `v${opts.version}` : t.draft), row(t.status, c.control.status === 'final' ? t.final : t.draft),
    row(t.approvers, c.control.approvers),
  ].join('')}</table>`);
  for (const s of visibleSections(c)) {
    parts.push(`<h2>${s.number}. ${escapeHtml(SECTION_TITLES[s.key][lang])}${both ? ` / <span dir="rtl">${escapeHtml(SECTION_TITLES[s.key].ar)}</span>` : ''}</h2>`);
    if (s.key === 'change_log') {
      const rows = changeLogRows(opts.versions, lang);
      parts.push(`<table><tr><th>${t.version}</th><th>${t.date}</th><th>${t.status}</th><th>${t.by}</th><th>${t.note}</th></tr>${rows.map((r) =>
        `<tr><td>${r.version}</td><td>${r.date}</td><td>${r.status === 'final' ? t.final : t.draft}</td><td>${escapeHtml(r.author)}</td><td>${escapeHtml(r.note)}</td></tr>`).join('')}</table>`);
      continue;
    }
    parts.push(s.html || '');
    if (both && s.html_ar) parts.push(`<div dir="rtl" lang="ar">${s.html_ar}</div>`);
    if (s.key === 'functional' && c.requirements.length) {
      parts.push(`<table><tr><th>${t.id}</th><th>${t.req}</th><th>${t.priority}</th><th>${t.status}</th><th>${t.owner}</th><th>${t.acc}</th></tr>${c.requirements.map((r) =>
        `<tr><td>${r.id}</td><td>${escapeHtml(r.description)}${both && r.description_ar ? `<br><span dir="rtl">${escapeHtml(r.description_ar)}</span>` : ''}</td><td>${t[r.priority]}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.owner)}</td><td>${escapeHtml(r.acceptance)}${both && r.acceptance_ar ? `<br><span dir="rtl">${escapeHtml(r.acceptance_ar)}</span>` : ''}</td></tr>`).join('')}</table>`);
    }
  }
  parts.push(`<p class="foot">${escapeHtml(t.confidential)}</p>`);
  return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(c.control.title)}</title>
<style>body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:11pt;color:#1e293b;line-height:1.5}h1{color:#1B2559;font-size:20pt}h2{color:#1B2559;font-size:14pt;border-bottom:1px solid #cbd5e1;padding-bottom:2pt}h3{font-size:12pt}table{border-collapse:collapse;width:100%;margin:6pt 0}th,td{border:1px solid #cbd5e1;padding:4pt;vertical-align:top;text-align:start}th{background:#eef2ff}mark{background:#fde68a}.foot{color:#64748b;font-size:9pt;margin-top:24pt}</style></head><body>${parts.join('\n')}</body></html>`;
}

export function brdMarkdown(c: BrdContent, opts: { version: number | null; versions: VersionMeta[] }): string {
  const lang = primaryLang(c);
  const t = L[lang];
  const cell = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = (html: string) => htmlToText(html).replace(new RegExp(`(${TBC_LABEL.en}|${TBC_LABEL.ar})`, 'g'), '**$1**');
  const out: string[] = [`# ${t.brd}`, `## ${c.control.title}`, '',
    `| ${t.control} | |`, '|---|---|',
    `| ${t.ticket} | #${cell(c.control.ticket_ref)} |`, `| ${t.company} | ${cell(c.control.company)} |`, `| ${t.requester} | ${cell(c.control.requester)} |`,
    `| ${t.date} | ${c.control.date} |`, `| ${t.version} | ${opts.version ? `v${opts.version}` : t.draft} |`,
    `| ${t.status} | ${c.control.status === 'final' ? t.final : t.draft} |`, `| ${t.approvers} | ${cell(c.control.approvers)} |`, ''];
  for (const s of visibleSections(c)) {
    out.push(`## ${s.number}. ${SECTION_TITLES[s.key][lang]}`, '');
    if (s.key === 'change_log') {
      out.push(`| ${t.version} | ${t.date} | ${t.status} | ${t.by} | ${t.note} |`, '|---|---|---|---|---|');
      for (const r of changeLogRows(opts.versions, lang)) out.push(`| ${r.version} | ${r.date} | ${r.status} | ${cell(r.author)} | ${cell(r.note)} |`);
      out.push('');
      continue;
    }
    if (s.html) out.push(md(s.html), '');
    if (c.language === 'both' && s.html_ar) out.push(md(s.html_ar), '');
    if (s.key === 'functional' && c.requirements.length) {
      out.push(`| ${t.id} | ${t.req} | ${t.priority} | ${t.status} | ${t.owner} | ${t.acc} |`, '|---|---|---|---|---|---|');
      for (const r of c.requirements) out.push(`| ${r.id} | ${cell(r.description)} | ${t[r.priority]} | ${r.status} | ${cell(r.owner)} | ${cell(r.acceptance)} |`);
      out.push('');
    }
  }
  out.push(`_${t.confidential}_`);
  return out.join('\n');
}

export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Allowlist for the BRD editor's HTML (the same tags the PDF and the viewer understand). Anything else is unwrapped
// (its text kept) or, for active content, removed with its content. Only <mark data-tbc="1"> keeps an attribute.
// The database refuses scripts, frames, images, links and event handlers again on save.

const KEEP = new Set(['P', 'BR', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'H3', 'H4', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'MARK']);
const RENAME: Record<string, string> = { B: 'strong', I: 'em', H1: 'h3', H2: 'h3', H5: 'h4', H6: 'h4', DIV: 'p' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'SOURCE',
  'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE']);

function clean(node: Node, doc: Document, out: Node): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out.appendChild(doc.createTextNode(child.textContent ?? ''));
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) return;
    const name = RENAME[tag] ?? (KEEP.has(tag) ? tag.toLowerCase() : null);
    if (!name) {
      clean(el, doc, out); // unwrap (span, a, font, section ...): keep the text
      return;
    }
    const copy = doc.createElement(name);
    if (name === 'mark' && el.getAttribute('data-tbc')) copy.setAttribute('data-tbc', '1');
    if ((name === 'td' || name === 'th')) {
      const span = Number(el.getAttribute('colspan'));
      if (Number.isInteger(span) && span > 1 && span <= 10) copy.setAttribute('colspan', String(span));
    }
    clean(el, doc, copy);
    out.appendChild(copy);
  });
}

export function sanitizeBrdHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const holder = doc.createElement('div');
  clean(doc.body, doc, holder);
  return holder.innerHTML
    .replace(/<p><\/p>/g, '')
    .replace(/(<br>){3,}/g, '<br><br>')
    .trim();
}

/** Plain text pasted or typed by people becomes paragraphs (escaped). */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

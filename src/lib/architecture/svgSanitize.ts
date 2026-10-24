// SVG pictures uploaded into architecture documents are cleaned in the browser before upload and are only ever shown
// through <img> (where browsers never run scripts in SVG). The cleaner keeps drawing elements only: no script, no
// foreignObject, no embedded or external images, links, styles that load URLs, or event handlers.

const KEEP = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient',
  'radialgradient', 'stop', 'marker', 'title', 'desc', 'clippath', 'symbol', 'pattern', 'mask',
]);
const URL_IN = /url\s*\(\s*(['"]?)(?!#)/i;
const BAD_VALUE = /(javascript|vbscript|data)\s*:/i;

function cleanNode(el: Element): void {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase().replace(/^svg:/, '');
    if (!KEEP.has(tag)) { child.remove(); continue; }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      const v = attr.value;
      if (name.startsWith('on') || name === 'href' || name.endsWith(':href') || name === 'src' || name === 'style' && URL_IN.test(v)
        || BAD_VALUE.test(v) || URL_IN.test(v)) {
        child.removeAttribute(attr.name);
      }
    }
    cleanNode(child);
  }
}

/** The cleaned SVG text, or null when the file is not an SVG picture. */
export function sanitizeSvg(text: string): string | null {
  if (!text || text.length > 5 * 1024 * 1024) return null;
  if (/<!ENTITY/i.test(text)) return null; // entity tricks
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  for (const attr of Array.from(root.attributes)) {
    const n = attr.name.toLowerCase();
    if (n.startsWith('on') || n === 'style' && URL_IN.test(attr.value) || BAD_VALUE.test(attr.value)) root.removeAttribute(attr.name);
  }
  cleanNode(root);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}

/** First bytes check: PNG and JPEG must really be PNG and JPEG. */
export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

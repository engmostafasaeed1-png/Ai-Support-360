// A small, strict reader for Mermaid flowchart text ("graph LR" / "flowchart TD") used by the diagram block of
// architecture documents. No third-party renderer and no HTML: the text is parsed into nodes and edges, laid out in
// layers, and drawn by React as SVG elements (text nodes only), so a diagram can never run a script or load a file.
// Only flowcharts are understood; anything else is reported as a line problem and not drawn.

export type Direction = 'LR' | 'RL' | 'TB' | 'BT';
export type Shape = 'rect' | 'round' | 'diamond' | 'circle';
export interface MNode { id: string; label: string; shape: Shape }
export interface MEdge { from: string; to: string; label: string; dashed: boolean; thick: boolean; arrow: boolean }
export interface MGraph { direction: Direction; nodes: MNode[]; edges: MEdge[]; problems: Array<{ line: number; text: string }> }

export const MAX_NODES = 60;
export const MAX_EDGES = 120;
export const MAX_LABEL = 60;

const ID = '([A-Za-z][A-Za-z0-9_]{0,40})';
// Node with optional shape: A, A[text], A(text), A{text}, A((text))
const NODE = new RegExp(`^${ID}\\s*(?:\\(\\((.{0,80}?)\\)\\)|\\[(.{0,80}?)\\]|\\((.{0,80}?)\\)|\\{(.{0,80}?)\\})?`);
// Edge operators: -->, ---, -.->, -.-, ==>, ===, with optional |label| or -- text -->
const EDGE = /^\s*(-->|---|-\.->|-\.-|==>|===)\s*(?:\|([^|]{0,80})\|)?\s*/;
const TEXT_EDGE = /^\s*--\s+([^-|]{1,80}?)\s+(-->|---)\s*/;

/** Label text: quotes and markup characters removed, length capped. */
export function cleanLabel(s: string | undefined): string {
  return String(s ?? '').replace(/^["']|["']$/g, '').replace(/[<>{}[\]`]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

export function parseMermaid(source: string): MGraph {
  const g: MGraph = { direction: 'LR', nodes: [], edges: [], problems: [] };
  const byId = new Map<string, MNode>();
  const lines = String(source ?? '').replace(/\r/g, '').split(/\n|;/);
  let headerSeen = false;

  const takeNode = (rest: string): { node: MNode; rest: string } | null => {
    const m = NODE.exec(rest);
    if (!m) return null;
    const id = m[1];
    const [circle, rect, round, diamond] = [m[2], m[3], m[4], m[5]];
    const shape: Shape = circle !== undefined ? 'circle' : rect !== undefined ? 'rect' : round !== undefined ? 'round' : diamond !== undefined ? 'diamond' : 'rect';
    const label = cleanLabel(circle ?? rect ?? round ?? diamond);
    let node = byId.get(id);
    if (!node) {
      if (byId.size >= MAX_NODES) return null;
      node = { id, label: label || id, shape };
      byId.set(id, node);
      g.nodes.push(node);
    } else if (label) {
      node.label = label;
      node.shape = shape;
    }
    return { node, rest: rest.slice(m[0].length) };
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) return;
    if (!headerSeen) {
      const h = /^(graph|flowchart)\s*(LR|RL|TB|TD|BT)?\s*$/i.exec(line);
      if (h) {
        headerSeen = true;
        const d = (h[2] ?? 'LR').toUpperCase();
        g.direction = (d === 'TD' ? 'TB' : d) as Direction;
        return;
      }
      g.problems.push({ line: i + 1, text: line.slice(0, 80) });
      headerSeen = true; // only flowcharts: keep reading, but say so
      return;
    }
    if (/^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b/i.test(line)) {
      // Styling, links and groups are not drawn (click could open a link); said, not silently ignored.
      g.problems.push({ line: i + 1, text: line.slice(0, 80) });
      return;
    }
    let first = takeNode(line);
    if (!first) { g.problems.push({ line: i + 1, text: line.slice(0, 80) }); return; }
    let rest = first.rest;
    let ok = true;
    while (rest.trim()) {
      let op: string;
      let label = '';
      const te = TEXT_EDGE.exec(rest);
      const e = te ? null : EDGE.exec(rest);
      if (te) { op = te[2]; label = cleanLabel(te[1]); rest = rest.slice(te[0].length); }
      else if (e) { op = e[1]; label = cleanLabel(e[2]); rest = rest.slice(e[0].length); }
      else { ok = false; break; }
      const next = takeNode(rest.trimStart());
      if (!next) { ok = false; break; }
      if (g.edges.length < MAX_EDGES) {
        g.edges.push({ from: first.node.id, to: next.node.id, label, dashed: op.includes('.'), thick: op.startsWith('='), arrow: op.endsWith('>') });
      }
      first = next;
      rest = next.rest;
    }
    if (!ok) g.problems.push({ line: i + 1, text: line.slice(0, 80) });
  });
  if (!headerSeen && g.nodes.length === 0) g.problems.push({ line: 1, text: '' });
  return g;
}

export interface LaidNode extends MNode { x: number; y: number; w: number; h: number }
export interface Layout { width: number; height: number; nodes: LaidNode[]; edges: Array<MEdge & { x1: number; y1: number; x2: number; y2: number }> }

/** Layered layout: each node's layer is its longest path from a root (cycles are cut), nodes spread inside a layer. */
export function layoutGraph(g: MGraph, measure: (text: string) => number = (t) => t.length * 7): Layout {
  const layer = new Map<string, number>();
  for (const n of g.nodes) layer.set(n.id, 0);
  // Bellman-Ford style relaxation, bounded so cycles cannot loop forever.
  for (let round = 0; round < g.nodes.length; round++) {
    let changed = false;
    for (const e of g.edges) {
      if (e.from === e.to) continue;
      const want = (layer.get(e.from) ?? 0) + 1;
      if (want > (layer.get(e.to) ?? 0) && want < g.nodes.length) { layer.set(e.to, want); changed = true; }
    }
    if (!changed) break;
  }
  const layers: string[][] = [];
  for (const n of g.nodes) (layers[layer.get(n.id) ?? 0] ??= []).push(n.id);
  const horizontal = g.direction === 'LR' || g.direction === 'RL';
  const nodeH = 40;
  const sizes = new Map(g.nodes.map((n) => [n.id, { w: Math.max(70, Math.min(220, measure(n.label) + 28)), h: n.shape === 'diamond' || n.shape === 'circle' ? 56 : nodeH }]));
  const gapMain = 70;
  const gapCross = 26;
  const laid = new Map<string, LaidNode>();
  let main = 20;
  const crossSizes = layers.map((ids) => (ids ?? []).reduce((acc, id) => acc + (horizontal ? sizes.get(id)!.h : sizes.get(id)!.w) + gapCross, -gapCross));
  const crossMax = Math.max(0, ...crossSizes);
  layers.forEach((ids, li) => {
    const list = ids ?? [];
    const thick = Math.max(0, ...list.map((id) => (horizontal ? sizes.get(id)!.w : sizes.get(id)!.h)));
    let cross = 20 + (crossMax - crossSizes[li]) / 2;
    for (const id of list) {
      const s = sizes.get(id)!;
      const node = g.nodes.find((n) => n.id === id)!;
      const x = horizontal ? main + (thick - s.w) / 2 : cross;
      const y = horizontal ? cross : main + (thick - s.h) / 2;
      laid.set(id, { ...node, x, y, w: s.w, h: s.h });
      cross += (horizontal ? s.h : s.w) + gapCross;
    }
    main += thick + gapMain;
  });
  let width = horizontal ? main - gapMain + 20 : crossMax + 40;
  let height = horizontal ? crossMax + 40 : main - gapMain + 20;
  const flip = g.direction === 'RL' || g.direction === 'BT';
  if (flip) for (const n of laid.values()) { if (horizontal) n.x = width - n.x - n.w; else n.y = height - n.y - n.h; }
  width = Math.max(width, 120);
  height = Math.max(height, 60);
  const edges = g.edges.filter((e) => laid.has(e.from) && laid.has(e.to)).map((e) => {
    const a = laid.get(e.from)!;
    const b = laid.get(e.to)!;
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Clip the line to the two boxes.
    const clip = (c: { x: number; y: number }, n: LaidNode, tx: number, ty: number) => {
      const dx = tx - c.x, dy = ty - c.y;
      if (!dx && !dy) return c;
      const sx = dx ? (n.w / 2) / Math.abs(dx) : Infinity;
      const sy = dy ? (n.h / 2) / Math.abs(dy) : Infinity;
      const s = Math.min(sx, sy, 1);
      return { x: c.x + dx * s, y: c.y + dy * s };
    };
    const p1 = clip(ac, a, bc.x, bc.y);
    const p2 = clip(bc, b, ac.x, ac.y);
    return { ...e, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });
  return { width, height, nodes: g.nodes.map((n) => laid.get(n.id)!).filter(Boolean), edges };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The same drawing as an SVG string (for the PDF export, which turns it into a picture). Every text is escaped and the
 * markup is built only from the fixed elements below.
 */
export function layoutToSvg(l: Layout, colors = { stroke: '#1B2559', fill: '#EEF2FF', text: '#1E293B', edge: '#64748B' }): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(l.width)}" height="${Math.round(l.height)}" viewBox="0 0 ${Math.round(l.width)} ${Math.round(l.height)}">`);
  parts.push(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${colors.edge}"/></marker></defs>`);
  parts.push(`<rect width="100%" height="100%" fill="#FFFFFF"/>`);
  for (const e of l.edges) {
    parts.push(`<line x1="${e.x1.toFixed(1)}" y1="${e.y1.toFixed(1)}" x2="${e.x2.toFixed(1)}" y2="${e.y2.toFixed(1)}" stroke="${colors.edge}" stroke-width="${e.thick ? 3 : 1.5}"${e.dashed ? ' stroke-dasharray="5 4"' : ''}${e.arrow ? ' marker-end="url(#a)"' : ''}/>`);
    if (e.label) parts.push(`<text x="${((e.x1 + e.x2) / 2).toFixed(1)}" y="${((e.y1 + e.y2) / 2 - 4).toFixed(1)}" font-family="sans-serif" font-size="11" text-anchor="middle" fill="${colors.text}">${esc(e.label)}</text>`);
  }
  for (const n of l.nodes) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    if (n.shape === 'diamond') parts.push(`<polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`);
    else if (n.shape === 'circle') parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${n.w / 2}" ry="${n.h / 2}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`);
    else parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.shape === 'round' ? 16 : 6}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`);
    parts.push(`<text x="${cx}" y="${cy + 4}" font-family="sans-serif" font-size="12" text-anchor="middle" fill="${colors.text}">${esc(n.label)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

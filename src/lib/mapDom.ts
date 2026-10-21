// The pieces of the consultants map that are made of HTML elements: the pin and the popup.
// Everything that comes from a consultant (name, specialty, place) is put in with textContent, never as HTML, so a name can not put anything into the page.

import { STATE_META, type AvailabilityState } from './mapMarkers';
import type { LinkState } from './consultantLinks';
import { arcPath, arcPattern, arcSegments, pointAt, ringGeometry, RING_OUTLINE, RING_SIZES, toneGradient, toneMix, TONE_COLOR, TONE_VARS, trackColor, type RingPill, type RingSummary } from './ringAvatar';
import { successColor, SUCCESS_STAR_SLOTS, SUCCESS_VARS, type SuccessLevel } from './successLevel';

export interface PinView {
  id: string;
  name: string;
  avatar: string;
  specialty: string;
  place: string;
  rating: number;
  reviews: number;
  rate: number;
  status: AvailabilityState;
  linkedinState: LinkState;
  credlyState: LinkState;
  hours?: string[];
  /** The pin is only the centre of the country. */
  approximate?: boolean;
  /** AI interview badge tier (Gold, Silver, Bronze, Verified). */
  tier?: string | null;
  /** Public profile photo (https only). */
  avatarUrl?: string | null;
  /** Match % and why-chips for the current filters, when there are any. */
  matchScore?: number | null;
  chips?: string[];
  /** Feature W performance ring (client rating + responsiveness), when known. */
  ring?: RingSummary | null;
}

export interface PopupLabels {
  reviews: string;
  viewProfile: string;
  openRequest: string;
  noPlace: string;
  approximate?: string;
  invite?: string;
  match?: string;
  badge?: string;
}

export const DEFAULT_LABELS: PopupLabels = {
  reviews: 'reviews',
  viewProfile: 'View profile',
  openRequest: 'Open a request',
  noPlace: 'Location not set',
  approximate: 'Approximate location (country)',
};

export interface PopupHandlers {
  onView?: (id: string) => void;
  /** Sessions are arranged inside a request: this opens the page for a new request. */
  onOpenRequest?: () => void;
  /** Invite this consultant to a new request. When given, it replaces "Open a request". */
  onInvite?: (id: string) => void;
  /** Feature O favourite toggle; omitted when the client may not edit favourites. Resolves to the new state. */
  favourite?: { on: boolean; toggle: (id: string) => Promise<boolean>; addLabel: string; removeLabel: string };
}

const STATE_TEXT: Record<AvailabilityState, string> = { available: '#16a34a', busy: '#d97706', offline: '#6b7280' };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The round pin on the map: the initials of the consultant and a dot in the colour of the availability. */
export function buildMarkerElement(view: PinView, selected: boolean): HTMLElement {
  const meta = STATE_META[view.status];
  const body = view.status === 'offline' ? '#64748b' : '#1B2559';
  const root = make('div', { position: 'relative', width: '48px', height: '56px', cursor: 'pointer' });
  root.dataset.pinId = view.id;
  root.setAttribute('aria-label', `${view.name}, ${meta.label}`);

  const badge = make(
    'div',
    {
      width: '44px',
      height: '44px',
      borderRadius: '14px',
      backgroundColor: body,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontWeight: '700',
      fontSize: '14px',
      border: selected ? '3px solid #3B82F6' : '2px solid white',
      boxShadow: selected ? '0 0 0 4px rgba(59,130,246,0.3), 0 4px 12px rgba(0,0,0,0.25)' : '0 4px 12px rgba(0,0,0,0.25)',
      transform: selected ? 'scale(1.15)' : 'none',
    },
    view.avatar,
  );
  badge.dataset.part = 'badge';

  const dot = make('div', { position: 'absolute', top: '-2px', right: '-2px', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: meta.color, border: '2px solid white' });
  dot.dataset.part = 'status';
  dot.dataset.status = view.status;

  const tail = make('div', { width: '0', height: '0', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: `8px solid ${body}`, margin: '0 auto' });

  root.append(badge, dot, tail);
  // Map pins are the smallest ring size: only the number, on a tiny badge at the bottom.
  if (view.ring) {
    const short = make('div', {
      position: 'absolute', left: '50%', top: '34px', transform: 'translateX(-50%)', padding: '0 4px', borderRadius: '9999px',
      fontSize: '9px', fontWeight: '700', lineHeight: '14px', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))',
      border: '1px solid hsl(var(--border))', whiteSpace: 'nowrap',
    }, view.ring.short);
    short.dataset.part = 'ring-short';
    short.setAttribute('aria-hidden', 'true');
    root.append(short);
  }
  return root;
}

function linkText(label: string, state: LinkState): string | null {
  if (state === 'checked') return `${label} checked`;
  if (state === 'linked') return `${label} linked`;
  return null;
}

/** The card that opens when a pin is clicked. The two buttons call the handlers with the id of the consultant. */
export function buildPopupElement(view: PinView, handlers: PopupHandlers = {}, labels: PopupLabels = DEFAULT_LABELS): HTMLElement {
  const meta = STATE_META[view.status];
  const root = make('div', { padding: '4px' });
  root.dataset.popupId = view.id;
  if (typeof document !== 'undefined' && document.documentElement.dir === 'rtl') root.dir = 'rtl';

  const head = make('div', { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' });
  const avatar = make(
    'div',
    { width: '44px', height: '44px', borderRadius: '12px', backgroundColor: view.status === 'offline' ? '#64748b' : '#1B2559', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '14px', flexShrink: '0', overflow: 'hidden' },
    view.avatarUrl && /^https:\/\//.test(view.avatarUrl) ? undefined : view.avatar,
  );
  if (view.avatarUrl && /^https:\/\//.test(view.avatarUrl)) {
    const img = make('img', { width: '100%', height: '100%', objectFit: 'cover' });
    img.src = view.avatarUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    avatar.append(img);
  }
  const who = make('div', { minWidth: '0' });
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
  who.append(
    make('div', { fontWeight: '600', fontSize: '14px', ...ellipsis }, view.name),
    make('div', { fontSize: '12px', color: '#6b7280', ...ellipsis }, view.specialty),
    make('div', { fontSize: '10px', color: '#9ca3af' }, view.place || labels.noPlace),
  );
  if (view.approximate) who.append(make('div', { fontSize: '10px', color: '#9ca3af', fontStyle: 'italic' }, labels.approximate || DEFAULT_LABELS.approximate || ''));
  if (view.ring) who.append(ringPills(view.ring));
  head.append(view.ring ? ringWrap(avatar, view.ring) : avatar, who);

  const rating = make('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' });
  rating.append(
    make('span', { color: '#eab308' }, '★'),
    make('span', { fontWeight: '600', fontSize: '14px' }, String(view.rating)),
    make('span', { fontSize: '12px', color: '#9ca3af' }, `(${view.reviews} ${labels.reviews})`),
  );

  const priceRow = make('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' });
  const price = make('div');
  price.append(make('span', { fontSize: '16px', fontWeight: '700' }, `$${view.rate}`), make('span', { fontSize: '10px', color: '#9ca3af' }, '/hr'));
  const state = make('span', { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '500', color: STATE_TEXT[view.status] });
  state.dataset.part = 'state';
  state.append(make('span', { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: meta.color, display: 'inline-block' }), document.createTextNode(meta.label));
  priceRow.append(price, state);

  root.append(head, rating, priceRow);

  const tags = [
    view.matchScore != null ? `${view.matchScore}% ${labels.match ?? 'match'}` : null,
    view.tier ? `${view.tier} ${labels.badge ?? 'badge'}` : null,
    ...(view.chips ?? []).slice(0, 4),
  ].filter((x): x is string => !!x);
  if (tags.length > 0) {
    const row = make('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' });
    row.dataset.part = 'chips';
    tags.forEach((text, i) => row.append(make('span', { fontSize: '10px', padding: '2px 8px', borderRadius: '999px', backgroundColor: i === 0 && view.matchScore != null ? '#dbeafe' : '#f3f4f6', color: '#1f2937' }, text)));
    root.append(row);
  }

  const links = [linkText('LinkedIn', view.linkedinState), linkText('Credly', view.credlyState)].filter((text): text is string => text !== null);
  if (links.length > 0) {
    const row = make('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' });
    for (const text of links) row.append(make('span', { fontSize: '10px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#f3f4f6', color: '#374151' }, text));
    root.append(row);
  }

  const hoursBox = make('div', { marginBottom: '8px', padding: '6px 8px', borderRadius: '8px', backgroundColor: '#f8fafc' });
  hoursBox.dataset.part = 'hours';
  hoursBox.append(make('div', { fontSize: '10px', fontWeight: '600', color: '#6b7280', marginBottom: '2px' }, 'Weekly availability'));
  const hours = view.hours ?? [];
  if (hours.length === 0) hoursBox.append(make('div', { fontSize: '11px', color: '#9ca3af' }, 'No hours set yet'));
  for (const h of hours) hoursBox.append(make('div', { fontSize: '11px', color: '#374151' }, h));
  root.append(hoursBox);

  const actions = make('div', { display: 'flex', gap: '6px' });
  const open = make('button', { flex: '1', fontSize: '10px', fontWeight: '500', padding: '6px 12px', borderRadius: '8px', backgroundColor: 'white', border: '1px solid #e5e7eb', cursor: 'pointer' }, labels.viewProfile);
  open.type = 'button';
  open.addEventListener('click', () => handlers.onView?.(view.id));
  const request = make('button', { flex: '1', fontSize: '10px', fontWeight: '500', padding: '6px 12px', borderRadius: '8px', backgroundColor: '#1B2559', color: 'white', border: 'none', cursor: 'pointer' }, handlers.onInvite ? (labels.invite ?? 'Invite') : labels.openRequest);
  request.type = 'button';
  request.addEventListener('click', () => (handlers.onInvite ? handlers.onInvite(view.id) : handlers.onOpenRequest?.()));
  actions.append(request, open);
  const fav = handlers.favourite;
  if (fav) {
    let on = fav.on;
    const heart = make('button', { fontSize: '14px', lineHeight: '1', padding: '6px 10px', borderRadius: '8px', backgroundColor: 'white', border: '1px solid #e5e7eb', cursor: 'pointer' });
    heart.type = 'button';
    heart.dataset.part = 'favourite';
    const paint = () => {
      heart.textContent = on ? '\u2665' : '\u2661';
      heart.style.color = on ? '#dc2626' : '#6b7280';
      heart.setAttribute('aria-pressed', String(on));
      heart.setAttribute('aria-label', on ? fav.removeLabel : fav.addLabel);
      heart.title = on ? fav.removeLabel : fav.addLabel;
    };
    paint();
    heart.addEventListener('click', async () => {
      heart.disabled = true;
      try { on = await fav.toggle(view.id); } catch { /* the page shows the error */ }
      heart.disabled = false;
      paint();
    });
    actions.append(heart);
  }
  root.append(actions);

  return root;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Leaflet popups stay light in dark mode, so the ring and pills inside use the light card colours. */
function lightSurface(node: HTMLElement): void {
  node.style.setProperty('--card', '0 0% 100%');
  node.style.setProperty('--foreground', '222 47% 11%');
  node.style.setProperty('--border', '214 32% 88%');
  // Success colours: the light-mode stops (>= 3:1 on white), also when the page itself is dark.
  const light: Record<string, string> = {
    '--success-bronze-a': '24 70% 42%', '--success-bronze-b': '16 65% 45%', '--success-silver-a': '210 14% 46%', '--success-silver-b': '205 22% 52%',
    '--success-gold-a': '44 95% 36%', '--success-gold-b': '50 92% 33%', '--success-platinum-a': '200 60% 44%', '--success-platinum-b': '215 55% 52%',
  };
  for (const [k, v] of Object.entries(light)) node.style.setProperty(k, v);
  node.style.setProperty('--review-star', '42 96% 40%');
  node.style.setProperty('--muted-foreground', '215 16% 40%');
}

const STAR = '12,1.8 15.1,8.4 22.2,9.2 16.9,14 18.4,21.1 12,17.5 5.6,21.1 7.1,14 1.8,9.2 8.9,8.4';
function starSvg(fill: string, stroke: string, size: number, width = 1.6): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'polygon');
  p.setAttribute('points', STAR);
  p.setAttribute('fill', fill);
  p.setAttribute('stroke', stroke);
  p.setAttribute('stroke-width', String(width));
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

/** DOM twin of LevelStars: rosette + 4 slots, filled by level (faint for the rest). */
export function levelStarsDom(level: SuccessLevel | null, stars: number): HTMLElement {
  const g = make('span', { display: 'inline-flex', alignItems: 'center', gap: '1px', flexShrink: '0' });
  g.dataset.part = 'success-stars';
  g.dataset.level = level ?? 'none';
  g.dataset.stars = String(stars);
  g.setAttribute('aria-hidden', 'true');
  g.append(make('span', { color: level ? successColor(level) : 'hsl(var(--muted-foreground))', fontSize: '11px', lineHeight: '1', marginInlineEnd: '2px' }, '🏵'));
  for (let i = 0; i < SUCCESS_STAR_SLOTS; i++) {
    const on = i < stars && level;
    const svg = on
      ? starSvg(`hsl(var(${SUCCESS_VARS[level][1]}))`, `hsl(var(${SUCCESS_VARS[level][0]}))`, 11)
      : starSvg('hsl(var(--muted-foreground) / 0.14)', 'hsl(var(--muted-foreground) / 0.4)', 11);
    svg.dataset.on = on ? 'true' : 'false';
    g.append(svg);
  }
  return g;
}

/** The two always-visible pills of the ring, as DOM (same text as the React pills). */
export function ringPills(ring: RingSummary): HTMLElement {
  const row = make('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' });
  row.dataset.part = 'ring-pills';
  lightSurface(row);
  const pill = (p: RingPill, icon: string, kind: string) => {
    const el = make('span', {
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 7px', borderRadius: '9999px', fontSize: '11px', fontWeight: '600',
      border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', whiteSpace: 'nowrap',
    });
    el.dir = 'auto';
    el.dataset.part = `ring-pill-${kind}`;
    el.dataset.tone = p.tone;
    const dot = make('span', { width: '7px', height: '7px', borderRadius: '9999px', background: toneGradient(p.tone), flexShrink: '0' });
    dot.setAttribute('aria-hidden', 'true');
    const ic = kind === 'rating'
      ? starSvg('none', 'hsl(var(--review-star))', 12, 2.2) as unknown as HTMLElement
      : make('span', { color: TONE_COLOR[p.tone] }, icon);
    ic.setAttribute('aria-hidden', 'true');
    if (kind === 'rating') ic.dataset.part = 'review-star';
    el.append(dot, ic, make('span', {}, p.text));
    row.append(el);
  };
  pill(ring.pills.rating, '★', 'rating');
  if (ring.pills.resp) pill(ring.pills.resp, '⚡', 'responsiveness');
  const sp = ring.pills.success;
  if (sp) {
    // Level stars + "Success: Gold" and the counts pill "42 requests · 38 solved · 90 %".
    const grp = make('span', { display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' });
    grp.dir = 'auto';
    grp.dataset.part = 'success-level';
    grp.dataset.level = sp.level ?? 'none';
    grp.setAttribute('role', 'group');
    grp.setAttribute('aria-label', sp.aria);
    const lab = make('span', {
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 7px', borderRadius: '9999px', fontSize: '11px', fontWeight: '600',
      border: `1px solid ${sp.level ? `hsl(var(${SUCCESS_VARS[sp.level][0]}) / 0.6)` : 'hsl(var(--border))'}`, background: 'hsl(var(--card))', whiteSpace: 'nowrap',
      color: sp.level ? successColor(sp.level) : 'hsl(var(--muted-foreground))',
    });
    lab.append(levelStarsDom(sp.level, sp.stars), make('span', {}, sp.label));
    grp.append(lab);
    if (sp.text) {
      const el = make('span', {
        display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: '9999px', fontSize: '11px', fontWeight: '600',
        border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', whiteSpace: 'nowrap',
      }, sp.text);
      el.dataset.part = 'ring-pill-success';
      grp.append(el);
    }
    row.append(grp);
  }
  return row;
}

/**
 * Popup version of the performance ring: the same arcs as the React ring (12 o'clock, clockwise in every direction),
 * with the full text as accessible name and native tooltip.
 */
export function ringWrap(avatar: HTMLElement, ring: RingSummary): HTMLElement {
  const g = ringGeometry('md');
  const glow = RING_SIZES.md.glow;
  const box = make('div', { position: 'relative', width: `${g.px}px`, height: `${g.px}px`, flexShrink: '0' });
  box.dataset.part = 'ring';
  lightSurface(box);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', ring.text);
  box.title = ring.text;
  box.dir = 'ltr';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${g.px} ${g.px}`);
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' });
  const el = (tag: string, attrs: Record<string, string | number>, style: Record<string, string> = {}) => {
    const n = document.createElementNS(SVG_NS, tag) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    Object.assign(n.style, style);
    return n;
  };
  const track = (r: number, w: number, color: string) => svg.append(el('circle', { cx: g.c, cy: g.c, r, fill: 'none', stroke: color, 'stroke-width': w }));
  const arc = (pct: number, r: number, w: number, tone: keyof typeof TONE_COLOR, low: boolean, kind: string) => {
    const d = arcPath(pct, r, g.c, g.c);
    if (!d) return;
    const { dash, opacity } = arcPattern(tone, low, w);
    const grp = el('g', {});
    grp.dataset.kind = kind; grp.dataset.tone = tone;
    grp.append(el('path', { d, fill: 'none', stroke: 'hsl(var(--card))', 'stroke-width': w + RING_OUTLINE * 2, 'stroke-linecap': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}) }));
    const colour = el('g', {}, { '--ring-glow-color': `hsl(var(${TONE_VARS[tone][0]}) / 0.5)`, '--ring-glow-blur': `${glow}px` });
    if (!low) colour.setAttribute('class', 'ring-glow');
    if (dash) {
      colour.append(el('path', { d, fill: 'none', stroke: TONE_COLOR[tone], 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-dasharray': dash, opacity }));
    } else {
      for (const seg of arcSegments(pct, r, g.c, g.c)) colour.append(el('path', { d: seg.d, fill: 'none', stroke: TONE_COLOR[tone], 'stroke-width': w }, { stroke: toneMix(tone, seg.t) }));
      const [sx, sy] = pointAt(0, r, g.c, g.c);
      const [ex, ey] = pointAt(Math.min(pct, 99.99), r, g.c, g.c);
      colour.append(el('circle', { cx: sx, cy: sy, r: w / 2, fill: TONE_COLOR[tone] }, { fill: toneMix(tone, 0) }));
      colour.append(el('circle', { cx: ex, cy: ey, r: w / 2, fill: TONE_COLOR[tone] }, { fill: toneMix(tone, 1) }));
      grp.append(colour, el('circle', { cx: ex, cy: ey, r: Math.max(0.9, w * 0.2), fill: 'hsl(var(--card))', opacity: 0.95 }));
      svg.append(grp);
      return;
    }
    grp.append(colour);
    svg.append(grp);
  };
  track(g.outerR, g.outerW, trackColor(ring.rating.tone));
  if (ring.resp.state !== 'hidden') track(g.innerR, g.innerW, trackColor(ring.resp.tone));
  if (ring.rating.state !== 'none') arc(ring.rating.pct, g.outerR, g.outerW, ring.rating.tone, ring.rating.state === 'low', 'rating');
  if (ring.resp.state === 'ok') arc(ring.resp.pct, g.innerR, g.innerW, ring.resp.tone, false, 'responsiveness');
  const inset = g.c - g.photoR;
  Object.assign(avatar.style, { position: 'absolute', inset: `${inset}px`, width: 'auto', height: 'auto', borderRadius: '50%', fontSize: '12px' });
  box.append(svg, avatar);
  return box;
}

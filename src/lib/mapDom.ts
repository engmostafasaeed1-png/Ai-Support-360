// The pieces of the consultants map that are made of HTML elements: the pin and the popup.
// Everything that comes from a consultant (name, specialty, place) is put in with textContent, never as HTML, so a name can not put anything into the page.

import { STATE_META, type AvailabilityState } from './mapMarkers';
import type { LinkState } from './consultantLinks';

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
}

export interface PopupLabels {
  reviews: string;
  viewProfile: string;
  bookSession: string;
  noPlace: string;
}

export const DEFAULT_LABELS: PopupLabels = {
  reviews: 'reviews',
  viewProfile: 'View profile',
  bookSession: 'Book session',
  noPlace: 'Location not set',
};

export interface PopupHandlers {
  onView?: (id: string) => void;
  onBook?: (id: string) => void;
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

  const head = make('div', { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' });
  const avatar = make(
    'div',
    { width: '44px', height: '44px', borderRadius: '12px', backgroundColor: view.status === 'offline' ? '#64748b' : '#1B2559', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '14px', flexShrink: '0' },
    view.avatar,
  );
  const who = make('div', { minWidth: '0' });
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
  who.append(
    make('div', { fontWeight: '600', fontSize: '14px', ...ellipsis }, view.name),
    make('div', { fontSize: '12px', color: '#6b7280', ...ellipsis }, view.specialty),
    make('div', { fontSize: '10px', color: '#9ca3af' }, view.place || labels.noPlace),
  );
  head.append(avatar, who);

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

  const links = [linkText('LinkedIn', view.linkedinState), linkText('Credly', view.credlyState)].filter((text): text is string => text !== null);
  if (links.length > 0) {
    const row = make('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' });
    for (const text of links) row.append(make('span', { fontSize: '10px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#f3f4f6', color: '#374151' }, text));
    root.append(row);
  }

  const actions = make('div', { display: 'flex', gap: '6px' });
  const open = make('button', { flex: '1', fontSize: '10px', fontWeight: '500', padding: '6px 12px', borderRadius: '8px', backgroundColor: 'white', border: '1px solid #e5e7eb', cursor: 'pointer' }, labels.viewProfile);
  open.type = 'button';
  open.addEventListener('click', () => handlers.onView?.(view.id));
  const book = make('button', { flex: '1', fontSize: '10px', fontWeight: '500', padding: '6px 12px', borderRadius: '8px', backgroundColor: '#1B2559', color: 'white', border: 'none', cursor: 'pointer' }, labels.bookSession);
  book.type = 'button';
  book.addEventListener('click', () => handlers.onBook?.(view.id));
  actions.append(book, open);
  root.append(actions);

  return root;
}

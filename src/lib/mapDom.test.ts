import { describe, it, expect, vi } from 'vitest';
import { buildMarkerElement, buildPopupElement, type PinView } from './mapDom';

const VIEW: PinView = {
  id: 'c-1',
  name: 'Jane Doe',
  avatar: 'JD',
  specialty: 'SAP FI/CO',
  place: 'Cairo, Egypt',
  rating: 4.6,
  reviews: 12,
  rate: 150,
  status: 'available',
  linkedinState: 'checked',
  credlyState: 'linked',
};

const buttonsOf = (popup: HTMLElement) => Array.from(popup.querySelectorAll('button'));
const buttonWith = (popup: HTMLElement, text: string) => buttonsOf(popup).filter(b => b.textContent === text)[0];

describe('buildMarkerElement', () => {
  it('shows the initials and the availability of the consultant', () => {
    const pin = buildMarkerElement(VIEW, false);
    expect(pin.textContent).toContain('JD');
    expect((pin.querySelector('[data-part="status"]') as HTMLElement).dataset.status).toBe('available');
    expect(pin.getAttribute('aria-label')).toBe('Jane Doe, Online');
  });

  it('draws the three states in three colours', () => {
    const colours = (['available', 'busy', 'offline'] as const).map(status => {
      const pin = buildMarkerElement({ ...VIEW, status }, false);
      return (pin.querySelector('[data-part="status"]') as HTMLElement).style.backgroundColor;
    });
    expect(new Set(colours).size).toBe(3);
  });

  it('makes the selected pin bigger', () => {
    const plain = buildMarkerElement(VIEW, false).querySelector('[data-part="badge"]') as HTMLElement;
    const picked = buildMarkerElement(VIEW, true).querySelector('[data-part="badge"]') as HTMLElement;
    expect(plain.style.transform).not.toContain('scale');
    expect(picked.style.transform).toContain('scale');
  });

  it('writes the initials as text, never as HTML', () => {
    const pin = buildMarkerElement({ ...VIEW, avatar: '<b>', name: '<img src=x>' }, false);
    expect(pin.querySelector('b')).toBeNull();
    expect(pin.querySelector('img')).toBeNull();
    expect(pin.textContent).toContain('<b>');
  });
});

describe('buildPopupElement', () => {
  it('shows who the consultant is, where, the rating, the rate and the availability', () => {
    const text = buildPopupElement(VIEW).textContent ?? '';
    for (const part of ['Jane Doe', 'SAP FI/CO', 'Cairo, Egypt', '4.6', '(12 reviews)', '$150', '/hr', 'Online']) expect(text).toContain(part);
  });

  it('says Busy and Offline in words', () => {
    expect((buildPopupElement({ ...VIEW, status: 'busy' }).querySelector('[data-part="state"]') as HTMLElement).textContent).toBe('Busy');
    expect((buildPopupElement({ ...VIEW, status: 'offline' }).querySelector('[data-part="state"]') as HTMLElement).textContent).toBe('Offline');
  });

  it('says for LinkedIn and Credly whether the link is checked or only linked, and nothing when there is none', () => {
    const both = buildPopupElement(VIEW).textContent ?? '';
    expect(both).toContain('LinkedIn checked');
    expect(both).toContain('Credly linked');
    const none = buildPopupElement({ ...VIEW, linkedinState: 'none', credlyState: 'none' }).textContent ?? '';
    expect(none).not.toContain('LinkedIn');
    expect(none).not.toContain('Credly');
  });

  it('says so when the consultant has not chosen a city', () => {
    expect(buildPopupElement({ ...VIEW, place: '' }).textContent).toContain('Location not set');
  });

  it('writes a name, a specialty and a place as text, never as HTML', () => {
    const popup = buildPopupElement({ ...VIEW, name: '<img src=x onerror="window.__pwned=1">', specialty: '<script>window.__pwned=2</script>', place: '<b>here</b>' });
    expect(popup.querySelector('img')).toBeNull();
    expect(popup.querySelector('script')).toBeNull();
    expect(popup.querySelector('b')).toBeNull();
    expect(popup.textContent).toContain('<img src=x onerror="window.__pwned=1">');
    expect(popup.innerHTML.includes('<img')).toBe(false);
  });

  it('calls the handlers with the id of the consultant when a button is clicked', () => {
    const onView = vi.fn();
    const onOpenRequest = vi.fn();
    const popup = buildPopupElement(VIEW, { onView, onOpenRequest });
    buttonWith(popup, 'View profile').click();
    expect(onView.mock.calls).toEqual([['c-1']]);
    expect(onOpenRequest.mock.calls).toHaveLength(0);
    buttonWith(popup, 'Open a request').click();
    expect(onOpenRequest.mock.calls).toHaveLength(1);
    expect(popup.querySelector('a')).toBeNull();
    expect(Array.from(popup.querySelectorAll('button')).some(b => /book/i.test(b.textContent || ''))).toBe(false);
  });

  it('has buttons that do not submit a form and survive missing handlers', () => {
    const popup = buildPopupElement(VIEW);
    expect(buttonsOf(popup)).toHaveLength(2);
    for (const b of buttonsOf(popup)) {
      expect(b.type).toBe('button');
      b.click();
    }
  });

  it('uses the words it is given', () => {
    const popup = buildPopupElement(VIEW, {}, { reviews: 'تقييمات', viewProfile: 'الملف', openRequest: 'افتح طلبًا', noPlace: '-' });
    expect(popup.textContent).toContain('(12 تقييمات)');
    expect(buttonWith(popup, 'الملف')).toBeTruthy();
    expect(buttonWith(popup, 'افتح طلبًا')).toBeTruthy();
  });
});

describe('buildPopupElement favourite heart (Feature O)', () => {
  it('has no heart unless the client may save favourites', () => {
    expect(buildPopupElement(VIEW).querySelector('[data-part="favourite"]')).toBeNull();
  });
  it('shows the saved state and switches after a click', async () => {
    const toggle = vi.fn().mockResolvedValue(false);
    const el = buildPopupElement(VIEW, { favourite: { on: true, toggle, addLabel: 'Add', removeLabel: 'Remove' } });
    const heart = el.querySelector('[data-part="favourite"]') as HTMLButtonElement;
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(heart.getAttribute('aria-label')).toBe('Remove');
    heart.click();
    await vi.waitFor(() => expect(heart.getAttribute('aria-pressed')).toBe('false'));
    expect(toggle).toHaveBeenCalledWith('c-1');
    expect(heart.getAttribute('aria-label')).toBe('Add');
  });
});

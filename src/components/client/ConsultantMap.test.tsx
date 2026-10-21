import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// A very small Leaflet: it records what the map is asked to draw, so that the test can look at the pins without a real map.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fake = vi.hoisted(() => {
  const state = { maps: [] as any[], layers: [] as any[], markers: [] as any[], bounds: [] as any[] };
  const L = {
    map: () => {
      const m: any = {};
      m.setView = vi.fn(() => m);
      m.fitBounds = vi.fn((b: any) => {
        state.bounds.push(b);
        return m;
      });
      m.panTo = vi.fn(() => m);
      m.invalidateSize = vi.fn();
      m.remove = vi.fn();
      state.maps.push(m);
      return m;
    },
    tileLayer: () => ({ addTo: (m: any) => m }),
    layerGroup: () => {
      const g: any = { items: [] as any[] };
      g.addTo = () => g;
      g.clearLayers = vi.fn(() => {
        g.items = [];
      });
      state.layers.push(g);
      return g;
    },
    divIcon: (o: any) => o,
    latLngBounds: (points: any) => points,
    marker: (latlng: any, o: any) => {
      const mk: any = { latlng, icon: o.icon, title: o.title, handlers: {} as Record<string, () => void>, popup: null as any };
      mk.bindPopup = (content: any) => {
        mk.popup = content;
        return mk;
      };
      mk.on = (event: string, fn: () => void) => {
        mk.handlers[event] = fn;
        return mk;
      };
      mk.addTo = (g: any) => {
        g.items.push(mk);
        return mk;
      };
      mk.openPopup = vi.fn(() => mk);
      mk.getLatLng = () => ({ lat: latlng[0], lng: latlng[1] });
      state.markers.push(mk);
      return mk;
    },
  };
  return { L, state };
});
vi.mock('leaflet', () => ({ default: fake.L }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('@/hooks/useResponsiveness', () => ({
  usePublicResponsiveness: () => ({ publicOn: true, byId: new Map([['a', { level: 'excellent', median_minutes: 20, response_rate: 95, stars: 5 }]]), levels: new Map() }),
}));
vi.mock('@/hooks/useRingStats', () => ({ useRatingMinReviews: () => 3, useRingStats: () => ({ data: undefined }) }));
const successState = vi.hoisted(() => ({ on: false }));
vi.mock('@/hooks/useSuccessStats', () => ({
  useSuccessConfig: () => ({ available: successState.on, publicOn: successState.on, settings: { bronze: 60, silver: 80, gold: 85, platinum: 100, min_requests: 5 } }),
  useSuccessStatsMap: () => (successState.on ? new Map([['a', { requests_total: 42, solved: 38, not_solved: 4, requests_12m: 20, solved_12m: 18 }]]) : null),
}));

import ConsultantMap, { type MapConsultant } from './ConsultantMap';

const person = (id: string, patch: Partial<MapConsultant> = {}): MapConsultant => ({
  id,
  name: `Name ${id}`,
  avatar: id.toUpperCase(),
  specialty: 'SAP FI/CO',
  rating: 4.5,
  reviews: 3,
  rate: 100,
  lat: 30.04,
  lng: 31.24,
  place: 'Cairo, Egypt',
  status: 'available',
  linkedinVerified: false,
  credlyVerified: false,
  ...patch,
});

const pinsDrawn = () => fake.state.layers[0].items as any[];
const statusOf = (marker: any) => (marker.icon.html as HTMLElement).querySelector('[data-part="status"]')?.getAttribute('data-status');
const buttonWith = (popup: HTMLElement, text: string) => Array.from(popup.querySelectorAll('button')).filter(b => b.textContent === text)[0];

beforeEach(() => {
  fake.state.maps.length = 0;
  fake.state.layers.length = 0;
  fake.state.markers.length = 0;
  fake.state.bounds.length = 0;
});
afterEach(() => cleanup());

describe('ConsultantMap', () => {
  it('draws one pin for every consultant who has a point and none for the others', () => {
    render(<ConsultantMap consultants={[person('a'), person('b', { status: 'busy' }), person('c', { lat: null, lng: null, place: '' })]} />);
    expect(pinsDrawn()).toHaveLength(2);
    expect(screen.queryByTestId('consultant-map-empty')).toBeNull();
  });

  it('colours every pin by availability', () => {
    render(<ConsultantMap consultants={[person('a'), person('b', { status: 'busy' }), person('c', { status: 'offline', lat: 24.71, lng: 46.68 })]} />);
    expect(pinsDrawn().map(statusOf)).toEqual(['available', 'busy', 'offline']);
  });

  it('does not put two consultants of the same city on top of each other', () => {
    render(<ConsultantMap consultants={[person('a'), person('b')]} />);
    const [first, second] = pinsDrawn();
    expect(`${first.latlng}`).not.toBe(`${second.latlng}`);
  });

  it('moves the map to the pins once and not at every refresh', () => {
    const list = [person('a'), person('b', { lat: 24.71, lng: 46.68 })];
    const { rerender } = render(<ConsultantMap consultants={list} />);
    expect(fake.state.bounds).toHaveLength(1);
    rerender(<ConsultantMap consultants={[...list]} />);
    expect(fake.state.bounds).toHaveLength(1);
    rerender(<ConsultantMap consultants={[...list, person('c', { lat: 51.51, lng: -0.13 })]} />);
    expect(fake.state.bounds).toHaveLength(2);
  });

  it('writes a name as text, never as HTML', () => {
    render(<ConsultantMap consultants={[person('a', { name: '<img src=x onerror=alert(1)>' })]} />);
    const popup = pinsDrawn()[0].popup as HTMLElement;
    expect(popup.querySelector('img')).toBeNull();
    expect(popup.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('puts the performance ring on the popup photo, with the same text as the cards', () => {
    render(<ConsultantMap consultants={[person('a', { rating: 4.8, reviews: 12 })]} />);
    const ring = (pinsDrawn()[0].popup as HTMLElement).querySelector('[data-part="ring"]') as HTMLElement;
    expect(ring.getAttribute('role')).toBe('img');
    expect(ring.getAttribute('aria-label')).toContain('Client rating 4.8 of 5 from 12 reviews');
    expect(ring.querySelector('[data-kind="rating"]')?.getAttribute('data-tone')).toBe('gold');
    expect(ring.querySelector('[data-kind="responsiveness"]')).not.toBeNull();
    const popup = pinsDrawn()[0].popup as HTMLElement;
    expect(popup.querySelector('[data-part="ring-pill-rating"]')?.textContent).toContain('4.8 (12)');
    expect(popup.querySelector('[data-part="ring-pill-responsiveness"]')?.textContent).toContain('Fast reply - 20 min');
    expect((pinsDrawn()[0].icon.html as HTMLElement).querySelector('[data-part="ring-short"]')?.textContent).toBe('4.8');
  });

  it('shows the Success level stars and counts in the popup (no band, no medal on the ring)', () => {
    successState.on = true;
    try {
      render(<ConsultantMap consultants={[person('a', { rating: 4.8, reviews: 12 })]} />);
      const popup = pinsDrawn()[0].popup as HTMLElement;
      const grp = popup.querySelector('[data-part="success-level"]') as HTMLElement;
      expect(grp.getAttribute('aria-label')).toBe('Success level Gold, 3 of 4 stars, 38 of 42 requests solved');
      expect(grp.textContent).toContain('Success: Gold');
      expect(grp.querySelectorAll('[data-part="success-stars"] svg[data-on="true"]').length).toBe(3);
      expect(grp.querySelectorAll('[data-part="success-stars"] svg[data-on]').length).toBe(4);
      expect(popup.querySelector('[data-part="ring-pill-success"]')?.textContent).toBe('42 requests · 38 solved · 90 %');
      expect(popup.querySelector('[data-part="review-star"] polygon')?.getAttribute('fill')).toBe('none');
      expect(popup.querySelector('[data-part="ring-medal"]')).toBeNull();
      expect(popup.querySelector('[data-kind="success"]')).toBeNull();
      expect(popup.querySelector('[data-part="ring"]')?.getAttribute('aria-label')).toContain('Success level: Gold (3 of 4 stars) - 38 of 42 requests solved (90 %) - last 12 months 90 %');
    } finally { successState.on = false; }
  });

  it('tells the page which pin was clicked', () => {
    const onSelectConsultant = vi.fn();
    render(<ConsultantMap consultants={[person('a')]} onSelectConsultant={onSelectConsultant} />);
    pinsDrawn()[0].handlers.click();
    expect(onSelectConsultant.mock.calls).toEqual([['a']]);
  });

  it('opens the popup of the chosen consultant', () => {
    render(<ConsultantMap consultants={[person('a'), person('b', { lat: 24.71, lng: 46.68 })]} selectedId="b" />);
    const [first, second] = pinsDrawn();
    expect(first.openPopup.mock.calls).toHaveLength(0);
    expect(second.openPopup.mock.calls.length).toBeGreaterThan(0);
  });

  it('wires the two buttons of the popup', () => {
    const onViewProfile = vi.fn();
    const onOpenRequest = vi.fn();
    render(<ConsultantMap consultants={[person('a')]} onViewProfile={onViewProfile} onOpenRequest={onOpenRequest} />);
    const popup = pinsDrawn()[0].popup as HTMLElement;
    buttonWith(popup, 'View profile').click();
    buttonWith(popup, 'Open a request').click();
    expect(onViewProfile.mock.calls).toEqual([['a']]);
    expect(onOpenRequest.mock.calls).toHaveLength(1);
    expect(Array.from(popup.querySelectorAll('button')).some(b => /book/i.test(b.textContent || ''))).toBe(false);
  });

  it('says so when nobody has chosen a city', () => {
    render(<ConsultantMap consultants={[person('a', { lat: null, lng: null })]} />);
    expect(pinsDrawn()).toHaveLength(0);
    expect(screen.getByTestId('consultant-map-empty').textContent).toContain('has chosen a city');
  });

  it('removes the map when it is closed', () => {
    const { unmount } = render(<ConsultantMap consultants={[person('a')]} />);
    unmount();
    expect(fake.state.maps[0].remove.mock.calls).toHaveLength(1);
  });
});

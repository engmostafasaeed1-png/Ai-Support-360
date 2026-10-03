import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// A very small Leaflet that records what the map is asked to draw.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fake = vi.hoisted(() => {
  const state = { maps: [] as any[], circles: [] as any[] };
  const L = {
    map: () => {
      const m: any = {};
      m.setView = vi.fn(() => m);
      m.invalidateSize = vi.fn();
      m.remove = vi.fn();
      state.maps.push(m);
      return m;
    },
    tileLayer: () => ({ addTo: (m: any) => m }),
    circle: (latlng: any, options: any) => {
      const c: any = { latlng, options, addTo: (m: any) => m };
      state.circles.push(c);
      return c;
    },
  };
  return { L, state };
});
vi.mock('leaflet', () => ({ default: fake.L }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import ConsultantLocationMap from './ConsultantLocationMap';

beforeEach(() => {
  fake.state.maps.length = 0;
  fake.state.circles.length = 0;
});
afterEach(() => cleanup());

describe('ConsultantLocationMap', () => {
  it('shows the place and a circle of 5 km around the centre of the city, not a pin', () => {
    render(<ConsultantLocationMap lat={30.04} lng={31.24} place="Cairo, Egypt" />);
    expect(screen.getByTestId('consultant-location-card').textContent).toContain('Cairo, Egypt');
    expect(fake.state.circles).toHaveLength(1);
    expect(fake.state.circles[0].latlng).toEqual([30.04, 31.24]);
    expect(fake.state.circles[0].options.radius).toBe(5000);
    expect(fake.state.maps[0].setView.mock.calls[0]).toEqual([[30.04, 31.24], 9]);
  });

  it('says that an address is never shown', () => {
    render(<ConsultantLocationMap lat={30.04} lng={31.24} place="Cairo, Egypt" />);
    expect(screen.getByTestId('consultant-location-card').textContent).toContain('never shown');
  });

  it('removes the map when it is closed', () => {
    const { unmount } = render(<ConsultantLocationMap lat={30.04} lng={31.24} place="Cairo, Egypt" />);
    unmount();
    expect(fake.state.maps[0].remove.mock.calls).toHaveLength(1);
  });
});

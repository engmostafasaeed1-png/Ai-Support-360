import { describe, it, expect } from 'vitest';
import { STATE_META, availabilityState, countWithoutPlace, spreadPins } from './mapMarkers';

const at = (id: string, lat: number | null, lng: number | null) => ({ id, lat, lng });

describe('availabilityState', () => {
  it('knows the three states of the database', () => {
    expect(availabilityState('available')).toBe('available');
    expect(availabilityState('busy')).toBe('busy');
    expect(availabilityState('offline')).toBe('offline');
  });

  it('treats anything else as offline', () => {
    expect(availabilityState(null)).toBe('offline');
    expect(availabilityState(undefined)).toBe('offline');
    expect(availabilityState('')).toBe('offline');
    expect(availabilityState('online')).toBe('offline');
  });
});

describe('STATE_META', () => {
  it('draws every state with its own colour, dot and name', () => {
    const states = ['available', 'busy', 'offline'] as const;
    expect(new Set(states.map(s => STATE_META[s].color)).size).toBe(3);
    expect(new Set(states.map(s => STATE_META[s].dot)).size).toBe(3);
    expect(states.map(s => STATE_META[s].label)).toEqual(['Online', 'Busy', 'Offline']);
  });

  it('ranks online before busy before offline', () => {
    expect(STATE_META.available.order).toBeLessThan(STATE_META.busy.order);
    expect(STATE_META.busy.order).toBeLessThan(STATE_META.offline.order);
  });
});

describe('spreadPins', () => {
  it('keeps the point of a consultant who is alone in the city', () => {
    expect(spreadPins([at('a', 30.04, 31.24)])).toEqual([{ id: 'a', lat: 30.04, lng: 31.24 }]);
  });

  it('leaves out the consultants without a point', () => {
    const pins = spreadPins([at('a', 30.04, 31.24), at('b', null, null), at('c', 30.04, null), at('d', null, 31.24), at('e', NaN, 31.24)]);
    expect(pins.map(p => p.id)).toEqual(['a']);
  });

  it('lays consultants of the same city around its centre, each at its own place', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const pins = spreadPins(ids.map(id => at(id, 30.04, 31.24)));
    expect(pins).toHaveLength(8);
    expect(new Set(pins.map(p => `${p.lat},${p.lng}`)).size).toBe(8);
    for (const p of pins) {
      expect(Math.abs(p.lat - 30.04)).toBeLessThan(0.05);
      expect(Math.abs(p.lng - 31.24)).toBeLessThan(0.06);
    }
  });

  it('gives the same places whatever the order of the input', () => {
    const one = spreadPins([at('c', 24.71, 46.68), at('a', 24.71, 46.68), at('b', 24.71, 46.68)]);
    const two = spreadPins([at('a', 24.71, 46.68), at('b', 24.71, 46.68), at('c', 24.71, 46.68)]);
    const place = (pins: typeof one, id: string) => pins.filter(p => p.id === id).map(p => `${p.lat},${p.lng}`)[0];
    for (const id of ['a', 'b', 'c']) expect(place(one, id)).toBe(place(two, id));
  });

  it('does not mix two cities', () => {
    const pins = spreadPins([at('a', 30.04, 31.24), at('b', 24.71, 46.68)]);
    expect(pins).toEqual([{ id: 'a', lat: 30.04, lng: 31.24 }, { id: 'b', lat: 24.71, lng: 46.68 }]);
  });

  it('keeps the order of the input', () => {
    const pins = spreadPins([at('z', 30.04, 31.24), at('y', 24.71, 46.68), at('x', 30.04, 31.24)]);
    expect(pins.map(p => p.id)).toEqual(['z', 'y', 'x']);
  });
});

describe('countWithoutPlace', () => {
  it('counts the consultants who cannot be shown', () => {
    expect(countWithoutPlace([at('a', 30.04, 31.24), at('b', null, null), at('c', 1, null)])).toBe(2);
    expect(countWithoutPlace([])).toBe(0);
  });
});

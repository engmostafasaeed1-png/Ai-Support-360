import { describe, it, expect } from 'vitest';
import { countryPoint, locationText } from './geo';
import { consultantPoint } from './consultantDirectory';
import { buildPopupElement } from './mapDom';

describe('locationText', () => {
  it('shows "City, Country" when both exist', () => expect(locationText('Riyadh', 'Saudi Arabia')).toBe('Riyadh, Saudi Arabia'));
  it('shows only the country when the city is empty', () => expect(locationText('', 'Qatar')).toBe('Qatar'));
  it('shows only the city when the country is empty', () => expect(locationText('Doha', null)).toBe('Doha'));
  it('says "Location not set" otherwise', () => expect(locationText(null, ' ')).toBe('Location not set'));
});

describe('countryPoint', () => {
  it('returns the centre of a known country', () => expect(countryPoint('Qatar')).toEqual({ lat: 25.35, lng: 51.18 }));
  it('returns null for an unknown country', () => expect(countryPoint('Atlantis')).toBeNull());
  it('gives the same small offset for the same consultant and different ones for others', () => {
    const a1 = countryPoint('Saudi Arabia', 'consultant-1');
    const a2 = countryPoint('Saudi Arabia', 'consultant-1');
    const b = countryPoint('Saudi Arabia', 'consultant-2');
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
    expect(Math.abs(a1!.lat - 23.89)).toBeLessThanOrEqual(0.31);
    expect(Math.abs(a1!.lng - 45.08)).toBeLessThanOrEqual(0.31);
  });
});

describe('map fallback pin', () => {
  it('puts a consultant with a country but an unknown city at the country centre, marked approximate', () => {
    const p = consultantPoint({ id: 'x', latitude: null, longitude: null, city: 'Small Town', country: 'Qatar' });
    expect(p?.approximate).toBe(true);
    expect(Math.abs(p!.lat - 25.35)).toBeLessThanOrEqual(0.31);
  });

  it('keeps a known city exact and leaves a consultant with neither off the map', () => {
    expect(consultantPoint({ latitude: null, longitude: null, city: 'Doha', country: 'Qatar' })).toEqual({ lat: 25.29, lng: 51.53 });
    expect(consultantPoint({ latitude: null, longitude: null, city: '', country: '' })).toBeNull();
  });

  it('says "Approximate location (country)" in the popup of such a pin', () => {
    const el = buildPopupElement({
      id: 'x', name: 'A', avatar: 'A', specialty: 'FI', place: 'Qatar', rating: 0, reviews: 0, rate: 0,
      status: 'available', linkedinState: 'none', credlyState: 'none', approximate: true,
    });
    expect(el.textContent).toContain('Approximate location (country)');
  });
});

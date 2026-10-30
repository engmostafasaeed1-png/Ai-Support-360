import { describe, it, expect } from 'vitest';
import { COUNTRIES, PLACES, citiesOf, cityPoint, placeLabel } from './geo';

// A loose box around each country (south, north, west, east): it only catches a typing mistake such as a lost minus sign.
const BOX: Record<string, [number, number, number, number]> = {
  'Saudi Arabia': [16, 33, 34, 56], UAE: [22, 26.5, 51, 57], Qatar: [24.4, 26.3, 50.7, 51.7], Kuwait: [28.5, 30.2, 46.5, 48.6],
  Bahrain: [25.5, 26.4, 50.3, 50.9], Oman: [16.5, 26.5, 51.5, 60], Egypt: [22, 32, 24.5, 37], Jordan: [29, 33.5, 34.8, 39.5],
  Lebanon: [33, 34.8, 35, 36.7], Iraq: [29, 37.5, 38.5, 49], Morocco: [27, 36, -13.5, -1], Tunisia: [30, 37.6, 7.5, 11.7],
  'United States': [24, 50, -125, -66.5], 'United Kingdom': [49.8, 60.9, -8.7, 1.8], Germany: [47, 55.1, 5.8, 15.1],
  France: [41.3, 51.2, -5.2, 9.6], Netherlands: [50.7, 53.6, 3.3, 7.3], India: [6.5, 36, 68, 97.5], Pakistan: [23.5, 37.1, 60.8, 77.9],
  Philippines: [4.5, 21.2, 116.9, 127], Malaysia: [0.8, 7.4, 99.6, 119.3], Singapore: [1.1, 1.5, 103.6, 104.1], Turkey: [35.8, 42.2, 25.6, 44.9],
  'South Africa': [-35, -22, 16.4, 33], Nigeria: [4, 14, 2.6, 14.7], Brazil: [-34, 5.4, -74, -34.7], Canada: [41.6, 70, -141, -52],
  Australia: [-44, -10, 112.9, 153.7], Japan: [30, 46, 129, 146], 'South Korea': [33, 38.7, 124.5, 131.9], China: [18, 53.6, 73.5, 135],
  Indonesia: [-11, 6, 95, 141], Thailand: [5.6, 20.5, 97.3, 105.7], Vietnam: [8.5, 23.4, 102, 109.5], Italy: [36.6, 47.1, 6.6, 18.6],
  Spain: [36, 43.8, -9.3, 3.4], Poland: [49, 54.9, 14.1, 24.2], Switzerland: [45.8, 47.9, 5.9, 10.6], Sweden: [55.3, 69.1, 11, 24.2],
  Ireland: [51.4, 55.4, -10.7, -5.9],
  Libya: [19.5, 33.2, 9.3, 25.2], Algeria: [19, 37.1, -8.7, 12], Sudan: [8.6, 22.3, 21.8, 38.6], Mauritania: [14.7, 27.3, -17.1, -4.8],
  Belgium: [49.5, 51.5, 2.5, 6.4], Austria: [46.3, 49.1, 9.5, 17.2], Portugal: [36.9, 42.2, -9.6, -6.2], Greece: [34.8, 41.8, 19.3, 29.7],
  Norway: [57.9, 71.2, 4.5, 31.2], Denmark: [54.5, 57.8, 8, 15.2], Finland: [59.8, 70.1, 20.5, 31.6], Iceland: [63.3, 66.6, -24.6, -13.4],
  Luxembourg: [49.4, 50.2, 5.7, 6.6], 'Czech Republic': [48.5, 51.1, 12, 18.9], Slovakia: [47.7, 49.7, 16.8, 22.6], Hungary: [45.7, 48.6, 16.1, 22.9],
  Romania: [43.6, 48.3, 20.2, 29.7], Bulgaria: [41.2, 44.3, 22.3, 28.7], Croatia: [42.4, 46.6, 13.4, 19.5], Slovenia: [45.4, 46.9, 13.3, 16.7],
  Serbia: [42.2, 46.2, 18.8, 23.1], 'Bosnia and Herzegovina': [42.5, 45.3, 15.7, 19.7], Montenegro: [41.8, 43.6, 18.4, 20.4], Kosovo: [41.8, 43.3, 20, 21.8],
  'North Macedonia': [40.8, 42.4, 20.4, 23.1], Albania: [39.6, 42.7, 19.2, 21.1], Cyprus: [34.5, 35.8, 32.2, 34.6], Malta: [35.7, 36.1, 14.1, 14.6],
  Estonia: [57.5, 59.7, 21.7, 28.3], Latvia: [55.6, 58.1, 20.9, 28.3], Lithuania: [53.8, 56.5, 20.9, 26.9], Ukraine: [44.3, 52.4, 22.1, 40.3],
  Moldova: [45.4, 48.5, 26.6, 30.2], Belarus: [51.2, 56.2, 23.1, 32.8], Russia: [41, 82, 19, 180], Georgia: [41, 43.6, 40, 46.8],
  Armenia: [38.8, 41.3, 43.4, 46.7], Azerbaijan: [38.3, 41.9, 44.7, 50.4], Andorra: [42.4, 42.7, 1.4, 1.8], Monaco: [43.7, 43.8, 7.4, 7.5],
  Liechtenstein: [47, 47.3, 9.4, 9.7], 'San Marino': [43.8, 44, 12.4, 12.6],
};

describe('the list of places', () => {
  it('has 82 countries, each with at least one city', () => {
    expect(COUNTRIES).toHaveLength(82);
    expect(new Set(COUNTRIES).size).toBe(82);
    expect(COUNTRIES).not.toContain('Israel');
    for (const p of PLACES) expect(p.cities.length).toBeGreaterThan(0);
  });

  it('has no city twice in a country', () => {
    for (const p of PLACES) {
      const names = p.cities.map(x => x.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('puts every city inside the box of its country, with at most 2 decimals', () => {
    for (const p of PLACES) {
      const box = BOX[p.country];
      expect(box !== undefined).toBe(true);
      for (const city of p.cities) {
        expect(city.lat >= box[0] && city.lat <= box[1]).toBe(true);
        expect(city.lng >= box[2] && city.lng <= box[3]).toBe(true);
        expect(Math.round(city.lat * 100) / 100).toBe(city.lat);
        expect(Math.round(city.lng * 100) / 100).toBe(city.lng);
      }
    }
  });
});

describe('citiesOf', () => {
  it('lists the cities of a country in order', () => {
    expect(citiesOf('Egypt')).toEqual(['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh']);
  });

  it('knows a country whatever the capitals and spaces', () => {
    expect(citiesOf('  egypt ')).toEqual(['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh']);
  });

  it('gives an empty list for an unknown country', () => {
    expect(citiesOf('Atlantis')).toEqual([]);
    expect(citiesOf('')).toEqual([]);
  });

  it('now has a list for the countries that had none before', () => {
    for (const country of ['Iraq', 'Morocco', 'Tunisia', 'Indonesia', 'Thailand', 'Vietnam', 'Italy', 'Spain', 'Poland', 'Switzerland', 'Sweden', 'Ireland']) {
      expect(citiesOf(country).length).toBeGreaterThan(0);
    }
  });
});

describe('cityPoint', () => {
  it('gives the centre of a city', () => {
    expect(cityPoint('Egypt', 'Cairo')).toEqual({ lat: 30.04, lng: 31.24 });
    expect(cityPoint('Germany', 'Walldorf')).toEqual({ lat: 49.3, lng: 8.64 });
  });

  it('ignores capitals and spaces', () => {
    expect(cityPoint(' egypt', 'CAIRO ')).toEqual({ lat: 30.04, lng: 31.24 });
  });

  it('gives null for a city that is not in that country', () => {
    expect(cityPoint('Egypt', 'Riyadh')).toBeNull();
    expect(cityPoint('Atlantis', 'Cairo')).toBeNull();
    expect(cityPoint('Egypt', '')).toBeNull();
  });
});

describe('placeLabel', () => {
  it('joins city and country', () => {
    expect(placeLabel('Cairo', 'Egypt')).toBe('Cairo, Egypt');
  });

  it('copes with a missing part', () => {
    expect(placeLabel(null, 'Egypt')).toBe('Egypt');
    expect(placeLabel('Cairo', '')).toBe('Cairo');
    expect(placeLabel(undefined, undefined)).toBe('');
    expect(placeLabel('  ', ' ')).toBe('');
  });
});

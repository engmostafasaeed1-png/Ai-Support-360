import { describe, expect, it } from 'vitest';
import { repairMalformedUrl } from './malformedUrl';

describe('repairMalformedUrl', () => {
  it('keeps valid URLs unchanged', () => {
    expect(repairMalformedUrl('/signup?ref=SAP-RAMI-7K2')).toBe('/signup?ref=SAP-RAMI-7K2');
    expect(repairMalformedUrl('/search?q=%D8%B3%D8%A7%D8%A8')).toBe('/search?q=%D8%B3%D8%A7%D8%A8');
  });

  it('escapes stray percent signs so the page can load', () => {
    expect(repairMalformedUrl('/signup?ref=%%%')).toBe('/signup?ref=%25%25%25');
    expect(repairMalformedUrl('/signup?ref=50%')).toBe('/signup?ref=50%25');
    expect(() => decodeURI(repairMalformedUrl('/signup?ref=%%%'))).not.toThrow();
  });

  it('falls back to a decodable path for broken byte sequences', () => {
    const out = repairMalformedUrl('/signup?ref=%E0%A4%A');
    expect(() => decodeURI(out)).not.toThrow();
    expect(out.startsWith('/signup')).toBe(true);
  });
});

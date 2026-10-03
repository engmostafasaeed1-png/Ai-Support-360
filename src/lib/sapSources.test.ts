import { describe, it, expect } from 'vitest';
import { FREE_SAP_SOURCES, freeSapSource, safeSourceUrl } from './sapSources';

describe('FREE_SAP_SOURCES', () => {
  it('lists the four official free SAP websites, each on its own SAP host', () => {
    expect(FREE_SAP_SOURCES.map(s => s.id)).toEqual(['help', 'community', 'learning', 'developers']);
    for (const s of FREE_SAP_SOURCES) {
      const home = new URL(s.home);
      expect(home.protocol).toBe('https:');
      expect(home.hostname).toBe(s.host);
      expect(s.host.endsWith('.sap.com')).toBe(true);
    }
  });

  it('finds a source by its id', () => {
    expect(freeSapSource('help')?.name).toBe('SAP Help Portal');
    expect(freeSapSource('nope')).toBeUndefined();
    expect(freeSapSource(5)).toBeUndefined();
  });
});

describe('safeSourceUrl', () => {
  it('accepts an https address on the host of the source', () => {
    expect(safeSourceUrl('help', 'https://help.sap.com/docs/search?q=fb60%20posting')).toBe('https://help.sap.com/docs/search?q=fb60%20posting');
    expect(safeSourceUrl('learning', 'https://learning.sap.com/search?query=accounts%20payable')).toBe('https://learning.sap.com/search?query=accounts%20payable');
  });

  it('refuses another host, another protocol, a login part and anything that is not an address', () => {
    expect(safeSourceUrl('help', 'https://community.sap.com/x')).toBeNull();
    expect(safeSourceUrl('help', 'http://help.sap.com/docs')).toBeNull();
    expect(safeSourceUrl('help', 'https://help.sap.com.evil.example/docs')).toBeNull();
    expect(safeSourceUrl('help', 'https://user:pass@help.sap.com/docs')).toBeNull();
    expect(safeSourceUrl('help', 'javascript:alert(1)')).toBeNull();
    expect(safeSourceUrl('help', 'not a url')).toBeNull();
    expect(safeSourceUrl('help', 42)).toBeNull();
    expect(safeSourceUrl('evil', 'https://help.sap.com/docs')).toBeNull();
    expect(safeSourceUrl('help', 'https://help.sap.com/' + 'a'.repeat(700))).toBeNull();
  });
});

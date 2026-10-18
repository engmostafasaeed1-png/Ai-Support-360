import { describe, expect, it } from 'vitest';
import { ALL_COUNTRIES, LOCALIZATION_COUNTRIES, regionOfCountry } from './profileTaxonomy';

describe('available country options', () => {
  it('excludes Israel from shared country options and region lookup', () => {
    expect(ALL_COUNTRIES).not.toContain('Israel');
    expect(LOCALIZATION_COUNTRIES.flatMap(group => group.items)).not.toContain('Israel');
    expect(regionOfCountry('Israel')).toBeNull();
  });
});
import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { requiredCount, requiredProfileMessage } from './requiredProfile';

describe('required profile metadata', () => {
  it('counts missing items from the server without duplicating them', () => {
    expect(requiredCount([{ consultant_id: 'a', missing: ['bio', 'country', 'bio'] }], 'a')).toBe(2);
  });
  it('does not claim completeness when data is unavailable', () => {
    expect(requiredCount(null, 'a')).toBeNull();
  });
  it('shows readable fields for submission errors', async () => {
    const i = i18next.createInstance(); await i.init({ lng: 'en', resources: {} });
    expect(requiredProfileMessage('missing_required:company_name,sap_modules', i.t)).toContain('Company name, SAP modules');
  });
});
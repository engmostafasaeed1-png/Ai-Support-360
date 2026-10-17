import { describe, expect, it } from 'vitest';
import { isForeignCspViolation } from '@/lib/diagnostics';
import { isExtensionCspReport } from '../../supabase/functions/_shared/errorNoise';

describe('CSP violation noise filter', () => {
  it('drops violations raised by browser extensions', () => {
    for (const sourceFile of ['chrome-extension', 'chrome-extension://abc/x.js', 'moz-extension://id/a.js', 'safari-extension://id/a.js']) {
      expect(isForeignCspViolation({ blockedURI: 'blob', sourceFile, sample: '' }), sourceFile).toBe(true);
    }
    expect(isExtensionCspReport('[diag:csp] CSP violation: worker-src blocked blob', { sourceFile: 'chrome-extension' })).toBe(true);
  });

  it('keeps genuine violations from our own origin', () => {
    expect(isForeignCspViolation({ blockedURI: 'blob', sourceFile: 'https://www.aisupport360.com/assets/index.js', sample: '' })).toBe(false);
    expect(isForeignCspViolation({ blockedURI: 'https://cdn.example.com/x.js', sourceFile: '', sample: '' })).toBe(false);
    expect(isExtensionCspReport('[diag:csp] CSP violation: worker-src blocked blob', { sourceFile: 'https://www.aisupport360.com/a.js' })).toBe(false);
  });
});

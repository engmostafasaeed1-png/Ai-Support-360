import { describe, expect, it } from 'vitest';
import type { AdminResponsivenessRow } from '@/hooks/useResponsiveness';
import { responsivenessSummary } from './responsivenessAdmin';

const row = (p: Partial<AdminResponsivenessRow>): AdminResponsivenessRow => ({
  consultant_id: Math.random().toString(36), name: 'X', level: 'new', public_level: 'new', counted_90d: 0,
  rate_90d: null, median_90d: null, no_response_30d: 0, warnings_sent: 0, disputes_open: 0, disputes_total: 0,
  computed_at: '2026-10-25T00:00:00Z', ...p,
});

describe('responsivenessSummary', () => {
  it('weights the overall rate by counted requests', () => {
    const s = responsivenessSummary([
      row({ public_level: 'excellent', counted_90d: 9, rate_90d: 100 }),
      row({ public_level: 'fair', counted_90d: 1, rate_90d: 0 }),
    ]);
    expect(s.overallRate).toBe(90);
  });

  it('has no overall rate when nothing was counted', () => {
    expect(responsivenessSummary([row({})]).overallRate).toBeNull();
  });

  it('counts rated consultants, levels, no-responses and open disputes', () => {
    const s = responsivenessSummary([
      row({ public_level: 'good', no_response_30d: 2, disputes_open: 1 }),
      row({ public_level: 'new', no_response_30d: 1 }),
      row({ public_level: 'good' }),
    ]);
    expect(s.total).toBe(3);
    expect(s.rated).toBe(2);
    expect(s.byLevel.good).toBe(2);
    expect(s.byLevel.new).toBe(1);
    expect(s.noResponses30d).toBe(3);
    expect(s.disputesOpen).toBe(1);
  });
});

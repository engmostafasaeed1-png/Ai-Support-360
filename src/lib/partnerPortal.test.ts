import { describe, expect, it } from 'vitest';
import { capacityConflict } from './partnerPortal';

describe('capacityConflict', () => {
  it('reports hours committed to agreements above the opened capacity', () => {
    expect(capacityConflict({ capacity_hours_week: 10, agreement_capacity: 16 })).toBe(6);
  });
  it('is zero when capacity covers commitments or is not set', () => {
    expect(capacityConflict({ capacity_hours_week: 20, agreement_capacity: 16 })).toBe(0);
    expect(capacityConflict({ capacity_hours_week: null, agreement_capacity: 16 })).toBe(0);
  });
});

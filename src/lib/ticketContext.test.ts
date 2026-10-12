import { describe, it, expect } from 'vitest';
import { buildTicketContext, ticketContextBadges } from './ticketContext';

describe('buildTicketContext', () => {
  it('keeps only the non-empty values', () => {
    expect(buildTicketContext({ industry: 'Retail - grocery & convenience', customer_segment: '', country: '  ', vertical_solutions: [], localization_solutions: ['Peppol network'] }))
      .toEqual({ industry: 'Retail - grocery & convenience', localization_solutions: ['Peppol network'] });
  });
  it('gives null when nothing is filled', () => {
    expect(buildTicketContext({})).toBeNull();
    expect(buildTicketContext({ industry: '', vertical_solutions: [] })).toBeNull();
  });
  it('limits lists to 12 and texts to 160 characters', () => {
    const ctx = buildTicketContext({ project_type: 'x'.repeat(200), vertical_solutions: Array.from({ length: 20 }, (_, i) => `v${i}`) })!;
    expect(ctx.project_type).toHaveLength(160);
    expect(ctx.vertical_solutions).toHaveLength(12);
  });
});

describe('ticketContextBadges', () => {
  it('lists the saved values with labels', () => {
    expect(ticketContextBadges({ country: 'Saudi Arabia', vertical_solutions: ['A'] })).toEqual(['Country: Saudi Arabia', 'Vertical solution: A']);
    expect(ticketContextBadges(null)).toEqual([]);
  });
});

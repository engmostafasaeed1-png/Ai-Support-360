import { describe, it, expect } from 'vitest';
import { buildTicketContext, ticketContextBadges, withTicketContext } from './ticketContext';

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

describe('withTicketContext (match call body and saved ticket row)', () => {
  it('adds the context to the match call and the ticket row', () => {
    const ctx = buildTicketContext({ country: 'Saudi Arabia', industry: '' });
    expect(withTicketContext({ action: 'match_consultants' }, ctx)).toEqual({ action: 'match_consultants', ticket_context: { country: 'Saudi Arabia' } });
    expect(withTicketContext({ id: 't1', title: 'x' }, ctx).ticket_context).toEqual({ country: 'Saudi Arabia' });
  });
  it('sends nothing when the context is empty', () => {
    expect(withTicketContext({ action: 'match_consultants' }, buildTicketContext({}))).not.toHaveProperty('ticket_context');
  });
});

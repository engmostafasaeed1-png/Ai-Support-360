import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

const state = { publicOn: false, reviewWeight: 15, byId: new Map(), levels: null as Map<string, string> | null };
vi.mock('@/hooks/useResponsiveness', () => ({ usePublicResponsiveness: () => state }));

import ResponsivenessChip from './ResponsivenessChip';
import { BlendedRatingStars } from './ResponsivenessRating';

describe('Responsiveness chip and blended rating', () => {
  beforeEach(() => { state.publicOn = false; state.byId = new Map(); });

  it('shows nothing while responsiveness_public is off', () => {
    state.byId.set('c1', { level: 'excellent', median_minutes: 20, response_rate: 95, stars: 5 });
    const { container } = render(<ResponsivenessChip consultantId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only level, median and rate to clients when public', () => {
    state.publicOn = true;
    state.byId.set('c1', { level: 'excellent', median_minutes: 20, response_rate: 95, stars: 5 });
    render(<ResponsivenessChip consultantId="c1" />);
    const chip = screen.getByTestId('responsiveness-chip');
    expect(chip).toHaveAttribute('data-level', 'excellent');
    expect(chip.textContent).toContain('Excellent');
    expect(chip.textContent).toContain('20 min');
    expect(chip.textContent).toContain('95%');
  });

  it('shows New below the minimum sample', () => {
    state.publicOn = true;
    render(<ResponsivenessChip consultantId="c2" />);
    expect(screen.getByTestId('responsiveness-chip')).toHaveAttribute('data-level', 'new');
  });

  it('the overall rating shows the blend with its breakdown, and client stars alone when private', () => {
    state.publicOn = true;
    state.byId.set('c1', { level: 'good', median_minutes: 120, response_rate: 85, stars: 4 });
    const { unmount } = render(<TooltipProvider><BlendedRatingStars consultantId="c1" rating={4.6} reviews={12} /></TooltipProvider>);
    expect(screen.getByTestId('blended-rating').textContent).toContain('= 4.51');
    unmount();
    state.publicOn = false;
    render(<TooltipProvider><BlendedRatingStars consultantId="c1" rating={4.6} reviews={12} /></TooltipProvider>);
    expect(screen.queryByTestId('blended-rating')).toBeNull();
    expect(screen.getByText('4.6')).toBeInTheDocument();
  });
});

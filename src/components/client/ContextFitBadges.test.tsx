import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContextFitBadges from './ContextFitBadges';

describe('ContextFitBadges', () => {
  it('shows the context fit, the matches and the gaps', () => {
    render(<ContextFitBadges fit={{ context_fit_score: 72, context_matches: ['Country: Saudi Arabia'], context_gaps: ['Industry: Retail'] }} />);
    // prefix and label are separate text nodes so the Arabic translator can translate each
    expect(screen.getByText('Context fit')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Country:')).toBeInTheDocument();
    expect(screen.getByText('Saudi Arabia')).toBeInTheDocument();
    expect(screen.getByText('Industry:')).toBeInTheDocument();
    expect(screen.getByText('Retail')).toBeInTheDocument();
  });
  it('shows nothing when the fields are absent or empty', () => {
    const { container, rerender } = render(<ContextFitBadges fit={{}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ContextFitBadges fit={{ context_fit_score: null, context_matches: [], context_gaps: [] }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ContextFitBadges fit={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

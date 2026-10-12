import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RatingStars from './RatingStars';

describe('RatingStars', () => {
  it.each([0, 2.5, 4.6, 5])('always shows five stars for %s', rating => {
    render(<RatingStars rating={rating} reviews={0} />);
    expect(screen.getAllByTestId('rating-star')).toHaveLength(5);
    expect(screen.getByRole('img', { name: `Rating ${rating} out of 5` })).toBeInTheDocument();
  });
  it('fills partial stars proportionally', () => {
    render(<RatingStars rating={4.6} reviews={12} />);
    const stars = screen.getAllByTestId('rating-star');
    expect(stars.map(s => s.getAttribute('data-fill'))).toEqual(['1', '1', '1', '1', '0.6']);
    expect(Number(stars[4].querySelector('rect')?.getAttribute('width'))).toBeCloseTo(14.4);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('reviews')).toBeInTheDocument();
  });
  it('shows no reviews without hiding the numeric rating', () => {
    render(<RatingStars rating={0} reviews={0} />);
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
  });
  it('uses the singular review label', () => {
    render(<RatingStars rating={5} reviews={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('review')).toBeInTheDocument();
  });
  it('shows compact counts', () => {
    render(<RatingStars rating={4} reviews={12} size="sm" />);
    expect(screen.getByText('12').parentElement?.textContent).toBe('(12)');
  });
});
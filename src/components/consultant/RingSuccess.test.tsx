import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useSuccessStats', () => ({
  useSuccessConfig: () => ({ available: true, publicOn: true, settings: { bronze: 60, silver: 80, gold: 85, platinum: 100, min_requests: 5 } }),
}));

import RingAvatar from './RingAvatar';
import RingPills from './RingPills';
import { LevelStars } from './SuccessStars';
import { SuccessStatsView } from './SuccessStatsCard';
import { ringSummary } from '@/lib/ringAvatar';
import { successView, type SuccessLevel } from '@/lib/successLevel';

const counts = (t: number, s: number) => ({ requests_total: t, solved: s, not_solved: t - s, requests_12m: t, solved_12m: s });
const sum = (t: number, s: number, lang: 'en' | 'ar' = 'en', publicOn = true) => ringSummary({
  rating: 4.8, reviews: 12, publicOn: true, resp: { level: 'excellent', median_minutes: 18, response_rate: 95 }, badge: 'gold', lang,
  success: { publicOn, counts: counts(t, s) },
});
const onStars = (root: ParentNode) => root.querySelectorAll('[data-testid="success-stars"] svg[data-on="true"]').length;
const slots = (root: ParentNode) => root.querySelectorAll('[data-testid="success-stars"] svg[data-on]').length;

describe('the ring keeps two arcs only', () => {
  it('no success band and no medal on the ring, AI shield stays', () => {
    const { container } = render(<RingAvatar name="Sara Ali" summary={sum(42, 38)} size="md" />);
    expect(screen.getByTestId('ring-arc-rating')).toBeInTheDocument();
    expect(screen.getByTestId('ring-arc-resp')).toBeInTheDocument();
    expect(container.querySelector('[data-kind="success"]')).toBeNull();
    expect(screen.queryByTestId('ring-medal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ring-track-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('ring-tier')).toHaveAttribute('data-tier', 'gold');
  });
  it('tooltip explains the success level and the two kinds of stars', () => {
    render(<RingAvatar name="Sara Ali" summary={sum(42, 38)} />);
    fireEvent.focus(screen.getByTestId('ring-avatar'));
    const pop = screen.getByTestId('ring-popover');
    expect(pop).toHaveTextContent('Client rating 4.8 of 5 from 12 reviews');
    expect(pop).toHaveTextContent('Success level: Gold (3 of 4 stars) - 38 of 42 requests solved (90 %) - last 12 months 90 %');
    expect(pop).toHaveTextContent('One outlined star with a number = client reviews; rosette with 4 level stars = Success level');
  });
});

describe('level stars', () => {
  it.each([['bronze', 1], ['silver', 2], ['gold', 3], ['platinum', 4]] as const)('%s fills %i of 4 slots', (level, n) => {
    const { container } = render(<LevelStars level={level as SuccessLevel} />);
    expect(slots(container)).toBe(4);
    expect(onStars(container)).toBe(n);
  });
  it('no level: four faint slots', () => {
    const { container } = render(<LevelStars level={null} />);
    expect(slots(container)).toBe(4);
    expect(onStars(container)).toBe(0);
  });
  it('gold and platinum shine, bronze and silver do not', () => {
    expect(render(<LevelStars level="gold" />).container.querySelectorAll('.success-star-shine').length).toBe(3);
    expect(render(<LevelStars level="platinum" />).container.querySelectorAll('.success-star-shine').length).toBe(4);
    expect(render(<LevelStars level="silver" />).container.querySelectorAll('.success-star-shine').length).toBe(0);
  });
});

describe('pills on cards and the profile header', () => {
  it('stars + "Success: Gold" + "42 requests · 38 solved · 90 %", with the accessible name', () => {
    render(<RingPills summary={sum(42, 38)} size="lg" />);
    const grp = screen.getByTestId('success-level');
    expect(grp).toHaveAccessibleName('Success level Gold, 3 of 4 stars, 38 of 42 requests solved');
    expect(screen.getByTestId('success-level-label')).toHaveTextContent('Success: Gold');
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('42 requests · 38 solved · 90 %');
    expect(onStars(grp)).toBe(3);
    expect(screen.getByTestId('ring-pill-ai')).toHaveTextContent('AI Interview: Gold');
  });
  it('the review rating is one outlined star with the number, visibly different from the level stars', () => {
    render(<RingPills summary={sum(42, 38)} />);
    const rating = screen.getByTestId('ring-pill-rating');
    expect(rating).toHaveTextContent('4.8 (12)');
    const star = rating.querySelector('[data-testid="review-star"]') as SVGElement;
    expect(star.style.fill).toBe('none');
    expect(rating.querySelector('[data-testid="success-stars"]')).toBeNull();
  });
  it('New below the minimum: faint stars, "Success: New", counts only', () => {
    render(<RingPills summary={sum(4, 4)} />);
    expect(screen.getByTestId('success-level-label')).toHaveTextContent('Success: New');
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('4 requests · 4 solved');
    expect(screen.getByTestId('ring-pill-success')).not.toHaveTextContent('%');
    expect(onStars(screen.getByTestId('success-level'))).toBe(0);
  });
  it('below 60 %: only the plain counts, no level and no percentage', () => {
    render(<RingPills summary={sum(10, 5)} />);
    expect(screen.getByTestId('success-level-label')).toHaveTextContent(/^Success$/);
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('10 requests · 5 solved');
    expect(screen.getByTestId('ring-pill-success')).not.toHaveTextContent('%');
  });
  it('nothing about success while the display is off', () => {
    render(<RingPills summary={sum(42, 38, 'en', false)} />);
    expect(screen.queryByTestId('success-level')).not.toBeInTheDocument();
  });
  it('small sizes: only the level stars, the percentage on hover, full text for screen readers', () => {
    render(<RingPills summary={sum(42, 38)} size="xs" />);
    const only = screen.getByTestId('success-stars-only');
    expect(only).toHaveAttribute('title', '90 %');
    expect(only).toHaveAccessibleName('Success level Gold, 3 of 4 stars, 38 of 42 requests solved');
    expect(only.textContent).toBe('');
    expect(screen.queryByTestId('ring-pill-success')).not.toBeInTheDocument();
  });
  it('right-to-left: Arabic texts and accessible name', () => {
    render(<div dir="rtl"><RingPills summary={sum(42, 38, 'ar')} size="lg" /></div>);
    expect(screen.getByTestId('success-level-label')).toHaveTextContent('النجاح: ذهبي');
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('الطلبات: 42 · المحلولة: 38 · 90 ٪');
    expect(screen.getByTestId('success-level')).toHaveAccessibleName('مستوى النجاح ذهبي، 3 من 4 نجوم، تم حل 38 من 42 طلبًا');
    expect(screen.getByTestId('success-level')).toHaveAttribute('dir', 'auto');
  });
});

describe('profile stats card', () => {
  it('lists requests, solved, not solved, rate, level stars and honest progress', () => {
    render(<SuccessStatsView view={successView(true, counts(20, 15))} />);
    const card = screen.getByTestId('success-stats-card');
    expect(card).toHaveAttribute('data-state', 'ok');
    expect(card).toHaveTextContent('Requests20');
    expect(card).toHaveTextContent('Solved15');
    expect(card).toHaveTextContent('Not solved5');
    expect(screen.getByTestId('success-stats-level')).toHaveAccessibleName('Success level Bronze, 1 of 4 stars, 15 of 20 requests solved');
    expect(onStars(screen.getByTestId('success-stats-level'))).toBe(1);
    expect(screen.getByTestId('success-progress')).toHaveTextContent('5 more solved requests in a row to reach Success: Silver');
  });
  it('Arabic card is right-to-left', () => {
    render(<SuccessStatsView view={successView(true, counts(3, 3))} lang="ar" />);
    expect(screen.getByTestId('success-stats-card')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('success-stats-card')).toHaveAttribute('data-state', 'new');
  });
});

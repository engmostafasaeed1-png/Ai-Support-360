import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useSuccessStats', () => ({
  useSuccessConfig: () => ({ available: true, publicOn: true, settings: { bronze: 60, silver: 80, gold: 85, platinum: 100, min_requests: 5 } }),
}));

import RingAvatar from './RingAvatar';
import RingPills from './RingPills';
import { SuccessStatsView } from './SuccessStatsCard';
import { ringSummary } from '@/lib/ringAvatar';
import { successView } from '@/lib/successLevel';

const counts = (t: number, s: number) => ({ requests_total: t, solved: s, not_solved: t - s, requests_12m: t, solved_12m: s });
const sum = (t: number, s: number, lang: 'en' | 'ar' = 'en', publicOn = true) => ringSummary({
  rating: 4.8, reviews: 12, publicOn: true, resp: { level: 'excellent', median_minutes: 18, response_rate: 95 }, badge: 'gold', lang,
  success: { publicOn, counts: counts(t, s) },
});

describe('Success on the ring', () => {
  it('draws the thin success band and the trophy chip, separate from the AI interview shield', () => {
    render(<RingAvatar name="Sara Ali" summary={sum(42, 38)} size="md" />);
    expect(screen.getByTestId('ring-arc-success')).toHaveAttribute('data-level', 'gold');
    expect(screen.getByTestId('ring-arc-success')).toHaveAttribute('data-pct', '90');
    expect(screen.getByTestId('ring-medal')).toHaveAttribute('data-level', 'gold');
    expect(screen.getByTestId('ring-tier')).toHaveAttribute('data-tier', 'gold');
  });
  it('tooltip reads the success line', () => {
    render(<RingAvatar name="Sara Ali" summary={sum(42, 38)} />);
    fireEvent.focus(screen.getByTestId('ring-avatar'));
    expect(screen.getByTestId('ring-popover')).toHaveTextContent('Success level: Gold - 38 of 42 requests solved (90 %) - last 12 months 90 %');
    expect(screen.getByTestId('ring-popover')).toHaveTextContent('A Success level shows after 5 finished requests.');
  });
  it('New below the minimum: track only, no band, no medal', () => {
    render(<RingAvatar name="Sara Ali" summary={sum(4, 4)} />);
    expect(screen.getByTestId('ring-track-success')).toBeInTheDocument();
    expect(screen.queryByTestId('ring-arc-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ring-medal')).not.toBeInTheDocument();
  });
  it('nothing about success while the display is off', () => {
    render(<RingAvatar name="Sara Ali" summary={sum(42, 38, 'en', false)} />);
    expect(screen.queryByTestId('ring-track-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ring-medal')).not.toBeInTheDocument();
  });
  it('card pills: "42 requests · 38 solved · 90 % (Gold)", AI chip says "AI Interview"', () => {
    render(<RingPills summary={sum(42, 38)} size="lg" />);
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('42 requests · 38 solved · 90 % (Gold)');
    expect(screen.getByTestId('ring-pill-ai')).toHaveTextContent('AI Interview: Gold');
  });
  it('small sizes show only the medal and the percentage', () => {
    render(<RingPills summary={sum(42, 38)} size="sm" />);
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('90 %');
    expect(screen.getByTestId('ring-pill-success')).not.toHaveTextContent('requests');
  });
  it('right-to-left: Arabic texts, the ring geometry stays left-to-right so arcs do not mirror', () => {
    const { container } = render(<div dir="rtl"><RingAvatar name="سارة علي" summary={sum(42, 38, 'ar')} /><RingPills summary={sum(42, 38, 'ar')} size="lg" /></div>);
    expect(screen.getByTestId('ring-pill-success')).toHaveTextContent('الطلبات: 42 · المحلولة: 38 · 90 ٪ (ذهبي)');
    expect(screen.getByTestId('ring-pill-success')).toHaveAttribute('dir', 'auto');
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
    const ltr = render(<RingAvatar name="Sara" summary={sum(42, 38)} />).container;
    const d = (root: ParentNode) => [...root.querySelectorAll('[data-testid="ring-arc-success"] path')].map((p) => p.getAttribute('d'));
    expect(d(container)).toEqual(d(ltr));
  });
});

describe('profile stats card', () => {
  it('lists requests, solved, not solved, rate, level and honest progress', () => {
    render(<SuccessStatsView view={successView(true, counts(20, 15))} />);
    const card = screen.getByTestId('success-stats-card');
    expect(card).toHaveAttribute('data-state', 'ok');
    expect(card).toHaveTextContent('Requests20');
    expect(card).toHaveTextContent('Solved15');
    expect(card).toHaveTextContent('Not solved5');
    expect(card).toHaveTextContent('Success: Bronze');
    expect(screen.getByTestId('success-progress')).toHaveTextContent('5 more solved requests in a row to reach Success: Silver');
  });
  it('Arabic card is right-to-left', () => {
    render(<SuccessStatsView view={successView(true, counts(3, 3))} lang="ar" />);
    expect(screen.getByTestId('success-stats-card')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('success-stats-card')).toHaveAttribute('data-state', 'new');
  });
});

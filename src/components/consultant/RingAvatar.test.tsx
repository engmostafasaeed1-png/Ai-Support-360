import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RingAvatar from './RingAvatar';
import RingPills from './RingPills';
import RingLegend from './RingLegend';
import { ringSummary } from '@/lib/ringAvatar';

const full = ringSummary({ rating: 4.8, reviews: 12, publicOn: true, resp: { level: 'excellent', median_minutes: 20, response_rate: 95 }, badge: 'gold' });

describe('RingAvatar', () => {
  it('draws both arcs with the right tones and gives the full text as the accessible name', () => {
    render(<RingAvatar name="Sara Ali" summary={full} size="md" />);
    const btn = screen.getByTestId('ring-avatar');
    expect(btn).toHaveAccessibleName(full.text);
    expect(screen.getByTestId('ring-arc-rating')).toHaveAttribute('data-tone', 'gold');
    expect(screen.getByTestId('ring-arc-resp')).toHaveAttribute('data-kind', 'responsiveness');
    expect(screen.getByTestId('ring-tier')).toHaveAttribute('data-tier', 'gold');
  });
  it('opens the details on keyboard focus and closes on Escape', () => {
    render(<RingAvatar name="Sara Ali" summary={full} />);
    const btn = screen.getByTestId('ring-avatar');
    fireEvent.focus(btn);
    expect(screen.getByTestId('ring-popover')).toHaveTextContent('Client rating 4.8 of 5 from 12 reviews');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByTestId('ring-popover')).not.toBeInTheDocument();
  });
  it('toggles on tap', () => {
    render(<RingAvatar name="Sara Ali" summary={full} />);
    const btn = screen.getByTestId('ring-avatar');
    const tap = () => {
      const ev = new MouseEvent('pointerdown', { bubbles: true });
      Object.defineProperty(ev, 'pointerType', { value: 'touch' });
      btn.dispatchEvent(ev);
      fireEvent.click(btn);
    };
    tap();
    expect(screen.getByTestId('ring-popover')).toBeInTheDocument();
    tap();
    expect(screen.queryByTestId('ring-popover')).not.toBeInTheDocument();
  });
  it('has no inner arc or track while responsiveness is private', () => {
    render(<RingAvatar name="Sara Ali" summary={ringSummary({ rating: 4.2, reviews: 5, publicOn: false })} />);
    expect(screen.queryByTestId('ring-arc-resp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ring-track-inner')).not.toBeInTheDocument();
  });
  it('is a plain image inside other controls', () => {
    render(<button type="button"><RingAvatar name="Sara Ali" summary={full} interactive={false} /></button>);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('img', { name: full.text })).toBeInTheDocument();
  });
  it('falls back to initials when the photo fails', () => {
    const { container } = render(<RingAvatar name="Sara Ali" avatarUrl="/x.jpg" summary={full} />);
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByText('SA')).toBeInTheDocument();
  });
});

describe('RingAvatar sizes, pills and legend', () => {
  it('shows only the number on a tiny badge at sm', () => {
    render(<RingAvatar name="Sara Ali" summary={full} size="sm" />);
    expect(screen.getByTestId('ring-short')).toHaveTextContent('4.8');
  });
  it('draws a gradient arc with an end dot', () => {
    render(<RingAvatar name="Sara Ali" summary={full} size="md" />);
    expect(screen.getByTestId('ring-arc-rating').querySelectorAll('path').length).toBeGreaterThan(2);
    expect(screen.getByTestId('ring-arc-rating-end')).toBeInTheDocument();
  });
  it('shows the rating and reply pills without hover', () => {
    const s = ringSummary({ rating: 4.8, reviews: 23, publicOn: true, resp: { level: 'excellent', median_minutes: 18, response_rate: 96 } });
    render(<RingPills summary={s} />);
    expect(screen.getByTestId('ring-pill-rating')).toHaveTextContent('4.8 (23)');
    expect(screen.getByTestId('ring-pill-responsiveness')).toHaveTextContent('Fast reply - 18 min');
  });
  it('explains the rings in the legend', () => {
    render(<RingLegend />);
    fireEvent.click(screen.getByRole('button', { name: 'How to read the ring' }));
    const box = screen.getByTestId('ring-legend-content');
    expect(box).toHaveTextContent('Outer ring: client reviews');
    expect(box).toHaveTextContent('Inner ring: responsiveness');
    expect(box).toHaveTextContent('Corner badge: AI interview level');
    expect(box).toHaveTextContent('4.6 and up');
  });
});

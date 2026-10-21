import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RingAvatar from './RingAvatar';
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
    fireEvent.pointerDown(btn, { pointerType: 'touch' });
    fireEvent.click(btn);
    expect(screen.getByTestId('ring-popover')).toBeInTheDocument();
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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CredibilityAvatar from './CredibilityAvatar';

vi.mock('@/hooks/useResponsiveness', () => ({
  usePublicResponsiveness: () => ({ publicOn: true, byId: new Map([['c1', { level: 'good', median_minutes: 60, response_rate: 90, stars: 4 }]]), levels: new Map() }),
}));
vi.mock('@/hooks/useRingStats', () => ({ useRatingMinReviews: () => 3, useRingStats: () => ({ data: undefined }) }));

const props = { name: 'Mostafa Saeed', initials: 'MS', total: 62, statusClass: 'bg-success', consultantId: 'c1', rating: 4.8, reviews: 12 };
describe('CredibilityAvatar', () => {
  it('keeps the credibility pill linked to the details', () => {
    render(<CredibilityAvatar {...props} />);
    const pill = screen.getByTestId('credibility-pill');
    expect(pill).toHaveAttribute('href', '#credibility');
    expect(pill).toHaveAccessibleName('Credibility score 62 percent. Open the credibility details.');
    expect(screen.getByText('62%').tagName).toBe('SPAN');
  });
  it.each([[95, 'high', 'text-success'], [62, 'good', 'text-info'], [45, 'fair', 'text-warning'], [5, 'low', 'text-muted-foreground']])('uses the tone for %s', (total, tone, cls) => {
    render(<CredibilityAvatar {...props} total={Number(total)} />);
    expect(screen.getByTestId('credibility-pill')).toHaveAttribute('data-tone', tone);
    expect(screen.getByTestId('credibility-pill')).toHaveClass(String(cls));
  });
  it('puts the performance ring around the photo with the centre label', () => {
    render(<CredibilityAvatar {...props} />);
    expect(screen.getByTestId('ring-avatar')).toHaveAttribute('data-size', 'xl');
    expect(screen.getByTestId('ring-arc-rating')).toHaveAttribute('data-tone', 'gold');
    expect(screen.getByTestId('ring-label')).toHaveTextContent('4.8 ★ | Good reply');
  });
  it('falls back to initials when the photo fails', () => {
    const { container } = render(<CredibilityAvatar {...props} avatarUrl="/photo.jpg" />);
    const photo = container.querySelector('img') as HTMLImageElement;
    expect(photo).toHaveAttribute('src', '/photo.jpg');
    expect(screen.queryByText('MS')).not.toBeInTheDocument();
    fireEvent.error(photo);
    expect(screen.getByText('MS')).toBeInTheDocument();
  });
});

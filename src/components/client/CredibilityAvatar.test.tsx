import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CredibilityAvatar from './CredibilityAvatar';

const props = { name: 'Mostafa Saeed', initials: 'MS', total: 62, statusClass: 'bg-success' };
describe('CredibilityAvatar', () => {
  it('links the ring and separate pill texts to the details', () => {
    render(<CredibilityAvatar {...props} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '#credibility');
    expect(screen.getByRole('link')).toHaveAccessibleName('Credibility score 62 percent. Open the credibility details.');
    expect(screen.getByText('62%').tagName).toBe('SPAN');
    expect(screen.getByText('credible').tagName).toBe('SPAN');
    expect(screen.getByText('MS')).toBeInTheDocument();
    const dash = screen.getByTestId('credibility-arc').getAttribute('stroke-dasharray')?.split(' ').map(Number) ?? [];
    expect(dash[0] / dash[1]).toBeCloseTo(0.62);
  });
  it.each([[95, 'high', 'text-success'], [62, 'good', 'text-info'], [45, 'fair', 'text-warning'], [5, 'low', 'text-muted-foreground']])('uses the tone for %s', (total, tone, cls) => {
    render(<CredibilityAvatar {...props} total={Number(total)} />);
    expect(screen.getByTestId('credibility-arc')).toHaveAttribute('data-tone', tone);
    expect(screen.getByTestId('credibility-arc')).toHaveClass(String(cls));
  });
  it('shows the photo and falls back to initials on failure', () => {
    render(<CredibilityAvatar {...props} avatarUrl="/photo.jpg" />);
    const photo = screen.getByRole('img', { name: props.name });
    expect(photo).toHaveAttribute('src', '/photo.jpg');
    expect(screen.queryByText('MS')).not.toBeInTheDocument();
    fireEvent.error(photo);
    expect(screen.getByText('MS')).toBeInTheDocument();
  });
});
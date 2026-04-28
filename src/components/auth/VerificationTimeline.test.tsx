import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerificationTimeline, {
  formatRelative,
  computeTimelineState,
} from './VerificationTimeline';

// Stub the expiry hook to keep tests deterministic.
vi.mock('@/hooks/useAuthEmailExpiry', () => ({
  useAuthEmailExpiry: () => 24 * 60, // 24h
}));

describe('formatRelative', () => {
  it('returns "expired" for non-positive durations', () => {
    expect(formatRelative(0)).toBe('expired');
    expect(formatRelative(-5_000)).toBe('expired');
  });

  it('formats sub-minute as seconds only', () => {
    expect(formatRelative(45_000)).toBe('45s left');
    expect(formatRelative(1_000)).toBe('1s left');
  });

  it('formats sub-hour as minutes + zero-padded seconds', () => {
    expect(formatRelative(2 * 60_000 + 5_000)).toBe('2m 05s left');
    expect(formatRelative(59 * 60_000 + 9_000)).toBe('59m 09s left');
  });

  it('formats >= 1h as hours + zero-padded minutes/seconds', () => {
    expect(formatRelative(3 * 3600_000 + 4 * 60_000 + 7_000)).toBe('3h 04m 07s left');
    expect(formatRelative(23 * 3600_000 + 59 * 60_000 + 59_000)).toBe('23h 59m 59s left');
  });
});

describe('computeTimelineState', () => {
  const sent = new Date('2026-04-28T10:00:00Z');

  it('reports near-zero progress immediately after send', () => {
    const s = computeTimelineState(sent, 1440, new Date(sent.getTime() + 1_000));
    expect(s.expired).toBe(false);
    expect(s.expiringSoon).toBe(false);
    expect(s.progress).toBeGreaterThan(0);
    expect(s.progress).toBeLessThan(1);
    expect(s.remainingMs).toBeGreaterThan(0);
  });

  it('reports ~50% progress at the midpoint', () => {
    const mid = new Date(sent.getTime() + 12 * 3600_000);
    const s = computeTimelineState(sent, 1440, mid);
    expect(s.progress).toBeCloseTo(50, 1);
    expect(s.expired).toBe(false);
    expect(s.expiringSoon).toBe(false);
  });

  it('flags expiringSoon when < 1h remains', () => {
    const almost = new Date(sent.getTime() + (1440 - 30) * 60_000); // 30m left
    const s = computeTimelineState(sent, 1440, almost);
    expect(s.expired).toBe(false);
    expect(s.expiringSoon).toBe(true);
    expect(s.remainingMs).toBeLessThan(60 * 60_000);
  });

  it('does NOT flag expiringSoon when exactly 1h remains', () => {
    const exact = new Date(sent.getTime() + (1440 - 60) * 60_000); // 60m left
    const s = computeTimelineState(sent, 1440, exact);
    expect(s.expiringSoon).toBe(false);
  });

  it('clamps progress to 100 once expired and flags expired=true', () => {
    const after = new Date(sent.getTime() + 25 * 3600_000);
    const s = computeTimelineState(sent, 1440, after);
    expect(s.expired).toBe(true);
    expect(s.expiringSoon).toBe(false);
    expect(s.progress).toBe(100);
    expect(s.remainingMs).toBeLessThanOrEqual(0);
  });

  it('computes expiresAt as sentAt + expiresInMinutes', () => {
    const s = computeTimelineState(sent, 60, sent);
    expect(s.expiresAt.getTime()).toBe(sent.getTime() + 60 * 60_000);
  });
});

describe('<VerificationTimeline />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Email sent" and an active expiry state mid-window', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 60 * 60_000)); // 1h in
    render(<VerificationTimeline sentAt={sent} expiresInMinutes={1440} />);
    expect(screen.getByText('Email sent')).toBeInTheDocument();
    expect(screen.getByText('Link expires')).toBeInTheDocument();
  });

  it('switches to "Link expired" past the expiry', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(<VerificationTimeline sentAt={sent} expiresInMinutes={1440} />);
    expect(screen.getByText('Link expired')).toBeInTheDocument();
  });

  it('renders the Resend CTA when expired and onResend is provided', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(
      <VerificationTimeline
        sentAt={sent}
        expiresInMinutes={1440}
        onResend={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /resend verification email/i })).toBeEnabled();
  });

  it('disables the Resend CTA during cooldown', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(
      <VerificationTimeline
        sentAt={sent}
        expiresInMinutes={1440}
        onResend={() => {}}
        resendCooldown={42}
      />,
    );
    const btn = screen.getByRole('button', { name: /resend available in 42s/i });
    expect(btn).toBeDisabled();
  });
});

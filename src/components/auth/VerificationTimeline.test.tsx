import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/config';
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

describe('boundary conditions', () => {
  const sent = new Date('2026-04-28T10:00:00Z');

  it('formatRelative: 0ms is treated as expired', () => {
    expect(formatRelative(0)).toBe('expired');
  });

  it('formatRelative: 1ms still rounds down to 0s left (not expired)', () => {
    expect(formatRelative(1)).toBe('0s left');
  });

  it('formatRelative: exactly 1 minute uses minute formatter', () => {
    expect(formatRelative(60_000)).toBe('1m 00s left');
  });

  it('formatRelative: exactly 59s stays in seconds-only formatter', () => {
    expect(formatRelative(59_000)).toBe('59s left');
  });

  it('formatRelative: exactly 1 hour uses hour formatter with zero minutes', () => {
    expect(formatRelative(3600_000)).toBe('1h 00m 00s left');
  });

  it('formatRelative: 1 hour minus 1ms still falls into minutes branch', () => {
    expect(formatRelative(3600_000 - 1)).toBe('59m 59s left');
  });

  it('formatRelative: very large durations (7 days) format without overflow', () => {
    const sevenDaysMs = 7 * 24 * 3600_000;
    expect(formatRelative(sevenDaysMs)).toBe('168h 00m 00s left');
  });

  it('computeTimelineState: 0ms elapsed → progress is exactly 0', () => {
    const s = computeTimelineState(sent, 1440, sent);
    expect(s.progress).toBe(0);
    expect(s.expired).toBe(false);
    expect(s.remainingMs).toBe(1440 * 60_000);
  });

  it('computeTimelineState: exactly 1h remaining is the boundary — NOT expiringSoon', () => {
    const at = new Date(sent.getTime() + (1440 - 60) * 60_000);
    const s = computeTimelineState(sent, 1440, at);
    expect(s.remainingMs).toBe(60 * 60_000);
    expect(s.expiringSoon).toBe(false);
    expect(s.expired).toBe(false);
  });

  it('computeTimelineState: 1ms under the 1h boundary flips to expiringSoon', () => {
    const at = new Date(sent.getTime() + (1440 - 60) * 60_000 + 1);
    const s = computeTimelineState(sent, 1440, at);
    expect(s.remainingMs).toBe(60 * 60_000 - 1);
    expect(s.expiringSoon).toBe(true);
  });

  it('computeTimelineState: at exact expiry, expired=true and progress=100', () => {
    const at = new Date(sent.getTime() + 1440 * 60_000);
    const s = computeTimelineState(sent, 1440, at);
    expect(s.expired).toBe(true);
    expect(s.progress).toBe(100);
    expect(s.remainingMs).toBe(0);
  });

  it('computeTimelineState: 1ms before expiry, NOT expired and progress < 100', () => {
    const at = new Date(sent.getTime() + 1440 * 60_000 - 1);
    const s = computeTimelineState(sent, 1440, at);
    expect(s.expired).toBe(false);
    expect(s.progress).toBeLessThan(100);
    expect(s.expiringSoon).toBe(true);
  });

  it('computeTimelineState: now < sentAt clamps progress to 0 (no negative)', () => {
    const before = new Date(sent.getTime() - 60_000);
    const s = computeTimelineState(sent, 1440, before);
    expect(s.progress).toBe(0);
    expect(s.expired).toBe(false);
  });

  it('computeTimelineState: very long expiry (30 days) midpoint reports ~50% without overflow', () => {
    const thirtyDaysMin = 30 * 24 * 60;
    const mid = new Date(sent.getTime() + 15 * 24 * 3600_000);
    const s = computeTimelineState(sent, thirtyDaysMin, mid);
    expect(s.progress).toBeCloseTo(50, 5);
    expect(s.expired).toBe(false);
    expect(s.expiringSoon).toBe(false);
  });

  it('computeTimelineState: very long expiry (30 days) just past expiry clamps to 100', () => {
    const thirtyDaysMin = 30 * 24 * 60;
    const after = new Date(sent.getTime() + 31 * 24 * 3600_000);
    const s = computeTimelineState(sent, thirtyDaysMin, after);
    expect(s.expired).toBe(true);
    expect(s.progress).toBe(100);
  });

  it('computeTimelineState: tiny expiry (1 minute) at 30s in is exactly 50%', () => {
    const half = new Date(sent.getTime() + 30_000);
    const s = computeTimelineState(sent, 1, half);
    expect(s.progress).toBeCloseTo(50, 5);
    expect(s.expiringSoon).toBe(true); // <1h remaining
    expect(s.expired).toBe(false);
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

describe('<VerificationTimeline /> accessibility', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the progress bar with proper ARIA attributes mid-window', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 12 * 3600_000)); // 50%
    render(<VerificationTimeline sentAt={sent} expiresInMinutes={1440} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(49);
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(51);
    expect(bar).toHaveAttribute('aria-valuetext');
    expect(bar.getAttribute('aria-valuetext')).toMatch(/left/i);
  });

  it('progress bar reports 100 and "expired" valuetext when past expiry', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(<VerificationTimeline sentAt={sent} expiresInMinutes={1440} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar.getAttribute('aria-valuetext')).toMatch(/expired/i);
  });

  it('exposes a polite live status region', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 60 * 60_000));
    render(<VerificationTimeline sentAt={sent} expiresInMinutes={1440} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('Resend button has aria-busy=false and aria-disabled=false when ready', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(
      <VerificationTimeline
        sentAt={sent}
        expiresInMinutes={1440}
        onResend={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /resend verification email/i });
    expect(btn).toHaveAttribute('aria-busy', 'false');
    expect(btn).toHaveAttribute('aria-disabled', 'false');
  });

  it('Resend button reflects cooldown via aria-disabled and aria-label', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(
      <VerificationTimeline
        sentAt={sent}
        expiresInMinutes={1440}
        onResend={() => {}}
        resendCooldown={30}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn.getAttribute('aria-label')).toMatch(/30/);
  });

  it('Resend button reflects in-flight state via aria-busy', () => {
    const sent = new Date('2026-04-28T10:00:00Z');
    vi.setSystemTime(new Date(sent.getTime() + 25 * 3600_000));
    render(
      <VerificationTimeline
        sentAt={sent}
        expiresInMinutes={1440}
        onResend={() => {}}
        resending
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });
});

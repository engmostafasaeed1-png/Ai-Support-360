import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n/config';
import { __resetNoticeGuard } from '@/lib/noticeGuard';

const h = vi.hoisted(() => ({
  notes: [] as Array<{ id: string; type: string; title: string; body: string; link: string | null; created_at: string }>,
  read: vi.fn(async (_ids: string[]) => {}),
}));
vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: true, ready: true }) }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/hooks/useReferralProgram', () => ({
  useMyReferralInvite: () => ({ data: null, isLoading: false }),
  useInvalidateReferral: () => () => undefined,
}));
vi.mock('@/hooks/useReferralNotices', () => ({
  REFERRAL_UNREAD_KEY: ['referral-notices-unread'],
  useUnreadReferralNotices: () => ({ data: h.notes, isLoading: false }),
  markNotificationsRead: (ids: string[]) => h.read(ids),
}));

import ReferralNoticePopup from './ReferralNoticePopup';
import ReferralInviteBanner from './ReferralInviteBanner';

const note = (id: string, title: string, body = 'A reward of 12.50 USD was reversed.') =>
  ({ id, type: 'referral', title, body, link: '/consultant/referrals', created_at: '2026-10-22T10:00:00Z' });
const mount = (ui = <ReferralNoticePopup />) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); __resetNoticeGuard(); h.read.mockReset(); h.read.mockImplementation(async () => {}); });
afterEach(() => cleanup());

describe('Refer & earn pop-up', () => {
  it('"Got it" closes at once, marks read in the background and never re-opens (reload, navigation)', async () => {
    h.notes = [note('n1', 'A referral reward was reversed')];
    h.read.mockImplementation(() => new Promise(() => {})); // server never answers
    const first = mount();
    expect(screen.getByTestId('referral-notice-popup')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.read).toHaveBeenCalledWith(['n1']);
    first.unmount();
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the X closes it the same way', async () => {
    h.notes = [note('n1', 'A referral was not accepted', 'Your referral was not accepted.')];
    mount();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.read).toHaveBeenCalledWith(['n1']);
  });

  it('several notices: one at a time with "1 of 2" and "Dismiss all"', async () => {
    h.notes = [note('a', 'A referral reward was reversed'), note('b', 'A referral was not accepted', 'Not accepted.')];
    mount();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.read).toHaveBeenCalledWith(['a', 'b']);
  });

  it('shows the primary action next to "Got it"', () => {
    h.notes = [note('n1', 'A referral reward was reversed')];
    mount();
    expect(screen.getByRole('button', { name: 'View earning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('the invitation is no pop-up: it shows one banner (once per device) with "Open Refer & earn"', () => {
    h.notes = [note('i1', '[TEST] Invitation: Refer & earn on AI Support 360', 'Hello ,\n\nYou are invited to Refer & earn.\n\nRewards depend on approved, paid work;')];
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    const b = mount(<ReferralInviteBanner />);
    const banner = screen.getByTestId('referral-invite-banner');
    expect(banner).toHaveTextContent('You are invited to Refer & earn.');
    expect(banner).not.toHaveTextContent('Hello ,');
    expect(banner).toHaveTextContent('Test');
    expect(screen.getByRole('button', { name: /Open Refer & earn/ })).toBeInTheDocument();
    b.unmount();
    mount(<ReferralInviteBanner />);
    expect(screen.queryByTestId('referral-invite-banner')).toBeNull();
  });
});

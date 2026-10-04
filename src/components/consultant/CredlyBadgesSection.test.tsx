import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn(), invoke: vi.fn() }));
const fetchMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        mocks.update(payload);
        return { eq: mocks.eq };
      },
    }),
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));

import CredlyBadgesSection from './CredlyBadgesSection';

const HINT = 'Enter your Credly username or the address of your Credly profile';

const typeName = (value: string) => fireEvent.change(screen.getByPlaceholderText('Enter your Credly username'), { target: { value } });
const link = () => fireEvent.click(screen.getByRole('button', { name: 'Link' }));

beforeEach(() => {
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.eq.mockResolvedValue({ error: null });
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({ data: null, error: null });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ badges: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('CredlyBadgesSection', () => {
  it('does not claim that it verifies the badges', () => {
    render(<CredlyBadgesSection consultantUserId="u-1" />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('The platform team checks that the profile is yours');
    expect(text).not.toContain('automatically verify');
  });

  it('refuses a name with a space and does not ask the database', async () => {
    render(<CredlyBadgesSection consultantUserId="u-1" />);
    typeName('jane doe');
    link();
    expect(await screen.findByText(HINT)).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByText(/Linked as/)).toBeNull();
  });

  it('saves the name that is taken out of the address of a profile, and shows it as linked', async () => {
    const onSaved = vi.fn();
    render(<CredlyBadgesSection consultantUserId="u-1" onSaved={onSaved} />);
    typeName('https://www.credly.com/users/jane-doe.1a2b3c4d');
    link();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ credly_username: 'jane-doe.1a2b3c4d' });
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'u-1');
    expect(await screen.findByText('@jane-doe.1a2b3c4d')).toBeTruthy();
    expect(screen.getByTestId('link-linked').textContent).toContain('Credly linked');
    expect(onSaved.mock.calls).toEqual([['jane-doe.1a2b3c4d']]);
  });

  it('does not show the profile as linked when the database refuses it, and shows the message', async () => {
    mocks.eq.mockResolvedValue({ error: { code: '22023', message: HINT } });
    render(<CredlyBadgesSection consultantUserId="u-1" />);
    typeName('jane-doe');
    link();
    expect(await screen.findByText(HINT)).toBeTruthy();
    expect(screen.queryByText(/Linked as/)).toBeNull();
  });

  it('says "checked" once the platform team has checked the profile', () => {
    render(<CredlyBadgesSection initialUsername="jane-doe" consultantUserId="u-1" checkedAt="2026-10-04T10:00:00Z" />);
    expect(screen.getByTestId('link-checked').textContent).toContain('Credly checked');
  });

  it('says "linked" while the platform team has not checked the profile', () => {
    render(<CredlyBadgesSection initialUsername="jane-doe" consultantUserId="u-1" checkedAt={null} />);
    expect(screen.getByTestId('link-linked').textContent).toContain('Credly linked');
  });

  it('shows the name that was saved earlier when the page around only has it after the first draw', () => {
    const { rerender } = render(<CredlyBadgesSection consultantUserId="u-1" />);
    expect(screen.getByPlaceholderText('Enter your Credly username')).toBeTruthy();
    rerender(<CredlyBadgesSection initialUsername="jane-doe.1a2b3c4d" consultantUserId="u-1" checkedAt={null} />);
    expect(screen.getByText('@jane-doe.1a2b3c4d')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Enter your Credly username')).toBeNull();
    expect(screen.getByTestId('link-linked').textContent).toContain('Credly linked');
  });

  it('does not bring the saved name back after the consultant removed the link', () => {
    render(<CredlyBadgesSection initialUsername="jane-doe" consultantUserId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(screen.getByPlaceholderText('Enter your Credly username')).toBeTruthy();
    expect(screen.queryByText(/Linked as/)).toBeNull();
  });

  it('loads the badges with one request', async () => {
    render(<CredlyBadgesSection consultantUserId="u-1" />);
    typeName('jane-doe');
    link();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

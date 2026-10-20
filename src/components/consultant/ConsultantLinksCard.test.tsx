import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ row: { current: null as Record<string, unknown> | null }, update: vi.fn(), eq: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.row.current, error: null }) }) }),
      update: (payload: unknown) => {
        mocks.update(payload);
        return { eq: mocks.eq };
      },
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import ConsultantLinksCard from './ConsultantLinksCard';

const ROW = {
  city: 'Cairo',
  country: 'Egypt',
  linkedin_url: 'https://www.linkedin.com/in/jane-doe',
  github_url: null,
  personal_website: null,
  credly_username: 'jane-doe.1a2b3c4d',
  linkedin_checked_at: '2026-10-04T10:00:00Z',
  credly_checked_at: null,
};

/** Shows the card and waits until the saved values are in the form. */
async function openCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConsultantLinksCard />
    </QueryClientProvider>,
  );
  const linkedin = (await screen.findByLabelText(/LinkedIn profile/)) as HTMLInputElement;
  await waitFor(() => expect(linkedin.value).toBe(ROW.linkedin_url));
  return linkedin;
}

beforeEach(() => {
  mocks.row.current = { ...ROW };
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.eq.mockResolvedValue({ error: null });
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});
afterEach(() => cleanup());

describe('ConsultantLinksCard', () => {
  it('shows the saved values and says which link the platform team has checked', async () => {
    await openCard();
    expect((screen.getByLabelText(/Credly profile/) as HTMLInputElement).value).toBe('jane-doe.1a2b3c4d');
    expect(screen.getByTestId('link-checked').textContent).toContain('LinkedIn checked');
    expect(screen.getByTestId('link-linked').textContent).toContain('Credly linked');
  });

  it('refuses a LinkedIn address that is not a profile, without asking the server', async () => {
    const linkedin = await openCard();
    fireEvent.change(linkedin, { target: { value: 'https://evil.example.com/in/jane' } });
    fireEvent.click(screen.getByRole('button', { name: /Save place and links/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/LinkedIn profile/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses a Credly name with a space, without asking the server', async () => {
    await openCard();
    fireEvent.change(screen.getByLabelText(/Credly profile/), { target: { value: 'jane doe' } });
    fireEvent.click(screen.getByRole('button', { name: /Save place and links/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Credly/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('saves the clean addresses and the point of the city', async () => {
    const linkedin = await openCard();
    fireEvent.change(linkedin, { target: { value: 'linkedin.com/in/jane-doe-2/' } });
    fireEvent.click(screen.getByRole('button', { name: /Save place and links/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({
      city: 'Cairo',
      country: 'Egypt',
      latitude: 30.04,
      longitude: 31.24,
      linkedin_url: 'https://www.linkedin.com/in/jane-doe-2',
      github_url: null,
      personal_website: null,
      credly_username: 'jane-doe.1a2b3c4d',
    });
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-1');
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('refuses to save without country and city (location is mandatory)', async () => {
    mocks.row.current = { ...ROW, city: null, country: null };
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: /Save place and links/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/country and city/)));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('shows the message of the database when it refuses a link', async () => {
    mocks.eq.mockResolvedValue({ error: { code: '22023', message: 'Enter your Credly username or the address of your Credly profile' } });
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: /Save place and links/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Enter your Credly username or the address of your Credly profile'));
  });
});

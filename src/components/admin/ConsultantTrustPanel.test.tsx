import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        mocks.update(payload);
        return { eq: mocks.eq };
      },
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import ConsultantTrustPanel, { type TrustFields } from './ConsultantTrustPanel';

const BASE: TrustFields = {
  id: 'c-1',
  city: 'Cairo',
  country: 'Egypt',
  linkedin_url: 'https://www.linkedin.com/in/jane-doe',
  linkedin_checked_at: null,
  credly_username: 'jane-doe.1a2b3c4d',
  credly_checked_at: '2026-10-04T10:00:00Z',
  github_url: 'https://github.com/jane',
  personal_website: 'javascript:alert(1)',
};

beforeEach(() => {
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.eq.mockResolvedValue({ error: null });
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});
afterEach(() => cleanup());

describe('ConsultantTrustPanel', () => {
  it('shows the place and opens LinkedIn, Credly and GitHub in a new tab', () => {
    render(<ConsultantTrustPanel consultant={BASE} />);
    expect(screen.getByTestId('trust-place').textContent).toContain('Cairo, Egypt');
    const linkedin = screen.getByLabelText('Open the LinkedIn page in a new tab') as HTMLAnchorElement;
    expect(linkedin.getAttribute('href')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(linkedin.getAttribute('target')).toBe('_blank');
    expect(linkedin.getAttribute('rel')).toContain('noopener');
    expect((screen.getByLabelText('Open the Credly page in a new tab') as HTMLAnchorElement).getAttribute('href')).toBe('https://www.credly.com/users/jane-doe.1a2b3c4d');
    expect((screen.getByText(/GitHub/).closest('a') as HTMLAnchorElement).getAttribute('href')).toBe('https://github.com/jane');
  });

  it('does not make a link of a website address that is not http or https', () => {
    render(<ConsultantTrustPanel consultant={BASE} />);
    expect(screen.queryByText(/Website/)).toBeNull();
  });

  it('says "linked" for a link that nobody checked and "checked" for one that was checked', () => {
    render(<ConsultantTrustPanel consultant={BASE} />);
    expect(screen.getByTestId('link-linked').textContent).toContain('LinkedIn linked');
    expect(screen.getByTestId('link-checked').textContent).toContain('Credly checked');
  });

  it('shows no link, and says so, for a value that is not a profile address', () => {
    render(<ConsultantTrustPanel consultant={{ ...BASE, linkedin_url: 'https://evil.example.com/in/jane', credly_username: null }} />);
    expect(screen.queryByLabelText('Open the LinkedIn page in a new tab')).toBeNull();
    expect(screen.queryByLabelText('Open the Credly page in a new tab')).toBeNull();
    expect(screen.getAllByText('Not given')).toHaveLength(2);
  });

  it('says so when the consultant has no city', () => {
    render(<ConsultantTrustPanel consultant={{ ...BASE, city: null, country: null }} />);
    expect(screen.getByTestId('trust-place').textContent).toContain('not on the map');
  });

  it('marks LinkedIn as checked with the time of the check', async () => {
    const onChanged = vi.fn();
    render(<ConsultantTrustPanel consultant={BASE} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as checked' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ linkedin_checked_at: expect.any(String) });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'c-1');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();
  });

  it('removes the check of Credly', async () => {
    render(<ConsultantTrustPanel consultant={BASE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove check' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ credly_checked_at: null });
  });

  it('shows the message of the database when the check can not be saved', async () => {
    mocks.eq.mockResolvedValue({ error: { message: 'permission denied' } });
    render(<ConsultantTrustPanel consultant={BASE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as checked' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permission denied'));
  });

  it('does not let anything be saved in the demo', () => {
    render(<ConsultantTrustPanel consultant={BASE} readOnly />);
    expect((screen.getByRole('button', { name: 'Mark as checked' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove check' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

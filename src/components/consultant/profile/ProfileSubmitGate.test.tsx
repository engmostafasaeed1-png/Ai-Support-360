import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildChecklist } from '@/lib/profileSubmission';

const h = vi.hoisted(() => ({
  missing: [] as string[],
  total: 5,
  state: 'draft' as string,
  mutateAsync: vi.fn(),
}));

vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useProfileFieldRules', () => ({
  useProfileFieldRules: () => ({
    rules: [{ field_key: 'bio' }, { field_key: 'cv' }, { field_key: 'country' }, { field_key: 'skills' }],
    isRequired: () => true, isVisible: () => true, labels: new Map(),
  }),
}));
vi.mock('@/hooks/useProfileSubmission', () => ({
  useProfileSubmission: () => ({
    loading: false, available: true, state: h.state, submittedAt: null, refetch: vi.fn(),
    checklist: buildChecklist(h.missing, h.total, (k) => ({ bio: 'Bio', cv: 'CV file', country: 'Country' } as Record<string, string>)[k] ?? k),
    submit: { mutateAsync: h.mutateAsync, isPending: false },
  }),
}));

import ProfileSubmitGate, { ProfileSubmissionProvider, SectionRequiredStatus } from './ProfileSubmitGate';

function renderGate() {
  return render(
    <ProfileSubmissionProvider>
      <section id="profile-details"><SectionRequiredStatus sectionId="profile-details" />
        <div className="contents" data-profile-field="bio"><label htmlFor="bio">Bio</label><textarea id="bio" /></div>
      </section>
      <ProfileSubmitGate />
    </ProfileSubmissionProvider>,
  );
}

beforeEach(() => {
  h.missing = []; h.total = 5; h.state = 'draft'; h.mutateAsync.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('profile submit gate (Feature V)', () => {
  it('stays locked while items are missing, explains why and lists every missing item', () => {
    h.missing = ['bio', 'cv'];
    renderGate();
    const submit = screen.getByTestId('submit-profile');
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).toHaveAttribute('aria-describedby', 'submit-explanation');
    expect(screen.getByRole('heading', { name: 'Complete these required items to finish' })).toBeInTheDocument();
    expect(screen.getByTestId('required-counter')).toHaveTextContent('2 of 5 required items left');
    expect(screen.getByTestId('missing-bio')).toHaveTextContent('Bio');
    expect(screen.getByTestId('missing-cv')).toHaveTextContent('CV file');
    expect(screen.getByTestId('draft-status')).toHaveTextContent('Draft - not submitted yet');
    expect(screen.getByTestId('section-missing-profile-details')).toHaveTextContent('1 missing');
    expect(screen.getByTestId('step-profile-details')).toHaveAttribute('data-incomplete', 'true');
  });

  it('pressing the locked button does not submit; it moves focus to the first missing item and announces it', async () => {
    h.missing = ['bio', 'cv'];
    renderGate();
    await act(async () => { fireEvent.click(screen.getByTestId('submit-profile')); });
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('missing-bio'));
    expect(screen.getByRole('status', { hidden: true }).textContent ?? '').toContain('2 required items left');
  });

  it('clicking a missing row focuses that field', () => {
    h.missing = ['bio'];
    renderGate();
    fireEvent.click(screen.getByTestId('missing-bio'));
    expect(document.activeElement).toBe(document.getElementById('bio'));
  });

  it('unlocks when everything is complete and submits', async () => {
    h.missing = [];
    h.mutateAsync.mockResolvedValue({ ok: true });
    renderGate();
    expect(screen.getByRole('heading', { name: 'All required items are complete - you can submit' })).toBeInTheDocument();
    const submit = screen.getByTestId('submit-profile');
    expect(submit).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('section-complete-profile-details')).toBeInTheDocument();
    await act(async () => { fireEvent.click(submit); });
    expect(h.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows the server\'s refusal when it still finds missing items', async () => {
    h.missing = [];
    h.mutateAsync.mockResolvedValue({ ok: false, missing: ['cv'], message: 'missing_required:cv' });
    renderGate();
    await act(async () => { fireEvent.click(screen.getByTestId('submit-profile')); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Some required items are still missing.'));
  });

  it('verified consultants are not locked out: no submit step, the list stays visible', () => {
    h.missing = ['cv']; h.state = 'verified';
    renderGate();
    expect(screen.queryByTestId('submit-profile')).toBeNull();
    expect(screen.getByTestId('missing-cv')).toBeInTheDocument();
  });
});

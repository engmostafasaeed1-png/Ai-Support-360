import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A new t identity can be forced by changing this value and re-rendering.
let tVersion = 0;
const makeT = () => { const v = tVersion; const fn = (k: string, d?: unknown) => (typeof d === 'string' ? d : k); (fn as any).v = v; return fn; };
let currentT = makeT();
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: currentT, i18n: { language: 'en' } }) }));

const tableData: Record<string, unknown> = {
  profiles: { display_name: 'Saved Name' },
  consultants: { id: 'c1', bio: 'Saved bio', hourly_rate: 50, currency: 'USD', timezone: 'Asia/Riyadh', languages: ['en'], city: 'Riyadh', country: 'SA' },
};
const builder = (table: string): any => {
  const b: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any) => res({ data: [], error: null });
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: tableData[table] ?? null, error: null });
      return () => b;
    },
  });
  return b;
};
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => builder(table),
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/confetti', () => ({ fireConfetti: vi.fn() }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/hooks/useBilling', () => ({ useMyPayoutDetails: () => ({ data: null }) }));
vi.mock('@/hooks/useConsultantProfile', () => ({ useConsultantProfile: () => ({ data: null }) }));
vi.mock('./EmbeddedGuides', () => ({
  EmbeddedGuideCard: () => null, EmbeddedSetupMessages: () => null, useEmbeddedGuides: () => ({ setCompleteness: () => {} }),
}));
vi.mock('./OnboardingGuidePanel', () => ({
  FieldHint: () => null, OnboardingGuidePanel: () => null, OnboardingGuideAccordion: () => null, OnboardingMobileProgress: () => null,
  OnboardingWelcome: () => null, OnboardingFinish: () => null, welcomeSeen: () => true, markWelcomeSeen: () => {},
}));
vi.mock('./steps/ProfileStep', () => ({
  default: ({ data, onChange }: any) => (
    <div>
      <input aria-label="Display name" value={data.displayName} onChange={e => onChange({ displayName: e.target.value })} />
      <textarea aria-label="Bio" value={data.bio} onChange={e => onChange({ bio: e.target.value })} />
      <input aria-label="City" value={data.city} readOnly />
    </div>
  ),
}));
for (const step of ['CertificationsStep', 'EducationStep', 'ProjectsStep']) vi.doMock(`./steps/${step}`, () => ({ default: () => null }));
vi.mock('./steps/CertificationsStep', () => ({ default: () => null }));
vi.mock('./steps/EducationStep', () => ({ default: () => null }));
vi.mock('./steps/ProjectsStep', () => ({ default: () => null }));
vi.mock('@/components/consultant/ProfileAvailability', () => ({ default: () => null }));
vi.mock('@/components/consultant/SetAvailabilityDialog', () => ({ default: () => null }));

const mounts = { skills: 0, experience: 0 };
let cvChanged: (() => void) | undefined;
vi.mock('@/components/consultant/SapExpertiseCard', () => ({ default: () => { useEffect(() => { mounts.skills++; }, []); return null; } }));
vi.mock('@/components/consultant/ProfileExperienceCard', () => ({ default: () => { useEffect(() => { mounts.experience++; }, []); return null; } }));
vi.mock('@/components/consultant/ExperienceCvCard', () => ({ default: ({ onProfileChanged }: any) => { cvChanged = onProfileChanged; return null; } }));

import ConsultantOnboarding from './ConsultantOnboarding';

const qc = new QueryClient();
const ui = () => <QueryClientProvider client={qc}><MemoryRouter><ConsultantOnboarding embedded /></MemoryRouter></QueryClientProvider>;

describe('ConsultantOnboarding embedded: unsaved typing', () => {
  beforeEach(() => { mounts.skills = 0; mounts.experience = 0; tVersion = 0; currentT = makeT(); });

  it('first load fills every field', async () => {
    render(ui());
    expect(await screen.findByDisplayValue('Saved Name')).toBeTruthy();
    expect(screen.getByLabelText('Bio')).toHaveValue('Saved bio');
    expect(screen.getByLabelText('City')).toHaveValue('Riyadh');
  });

  it('keeps typed values after a t change and a CV-import reload; untouched fields still reload', async () => {
    const view = render(ui());
    await screen.findByDisplayValue('Saved Name');
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Typed Name' } });
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Typed bio' } });

    tVersion++; currentT = makeT();
    view.rerender(ui());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText('Display name')).toHaveValue('Typed Name');
    expect(screen.getByLabelText('Bio')).toHaveValue('Typed bio');

    tableData.consultants = { ...(tableData.consultants as object), city: 'Jeddah' };
    await act(async () => { cvChanged?.(); });
    await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Jeddah'));
    expect(screen.getByLabelText('Display name')).toHaveValue('Typed Name');
    expect(screen.getByLabelText('Bio')).toHaveValue('Typed bio');
    expect(mounts.skills).toBe(2);
    expect(mounts.experience).toBe(2);
    tableData.consultants = { ...(tableData.consultants as object), city: 'Riyadh' };
  });

  it('a Save does not remount the skills and experience cards', async () => {
    render(ui());
    await screen.findByDisplayValue('Saved Name');
    expect(mounts.skills).toBe(1);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]); });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save' })[0]).not.toBeDisabled());
    expect(mounts.skills).toBe(1);
    expect(mounts.experience).toBe(1);
  });
});

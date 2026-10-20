import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ dismissed: null as null | { completed_at: string }, save: vi.fn(), start: vi.fn(), input: null as any }));

vi.mock('@/hooks/useTourProgress', () => ({
  useTourProgress: () => ({ progress: h.dismissed, isLoading: false, save: h.save, reset: vi.fn() }),
}));
vi.mock('@/components/tour/ConsultantTour', () => ({ useConsultantTour: () => ({ start: h.start, running: false }) }));
vi.mock('@/hooks/useBilling', () => ({ useMyPayoutDetails: () => ({ isLoading: false, data: { consultantId: 'c1', details: h.input?.payout ?? null } }) }));
vi.mock('@/hooks/useTelegram', () => ({ useTelegramStatus: () => ({ data: { active: false } }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ isLoading: false, data: h.input?.base ?? null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import GettingStartedCard, { gettingStartedItems } from './GettingStartedCard';

const full = {
  sap_roles: ['x'], seniority_level: 's', total_sap_years: 5, sap_technologies: ['a'], industries: ['b'], customer_segments: ['c'],
  vertical_solutions: ['d'], localization_countries: ['e'], localization_solutions: ['f'], project_types: ['g'], deployment_experience: ['h'],
  project_scale: 'm', work_modes: ['r'], working_week: 'w', language_levels: { en: 'x' }, ai_interview_completed_at: '2026-10-01', new_case_alerts: true, country: 'Egypt', city: 'Cairo',
};
const ack = { acknowledged_at: '2026-10-01', acknowledged_version: 'v1', verified_at: null };

const renderCard = () => render(<MemoryRouter><GettingStartedCard /></MemoryRouter>);

beforeEach(() => { h.dismissed = null; h.save.mockReset(); h.start.mockReset(); h.input = null; });
afterEach(() => cleanup());

describe('GettingStartedCard', () => {
  it('builds the eight items, including the mandatory location', () => {
    const items = gettingStartedItems({ completenessPercent: 80, skills: 1, interviewDone: false, slots: 0, payoutReady: true, alertsOn: false, bids: 0 });
    expect(items.map((i) => i.label)).toEqual([
      'Complete your profile', 'Add your location', 'Add your SAP expertise', 'Take the AI interview', 'Set your availability',
      'Add your bank details', 'Turn on alerts', 'Place your first bid',
    ]);
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual(['profile', 'expertise', 'bank']);
  });

  it('shows progress and starts the tour', () => {
    h.input = { base: { c: { ...full, ai_interview_completed_at: null }, skills: 2, slots: 0, bids: 0, pushDevices: 0 }, payout: null };
    renderCard();
    expect(screen.getByText('Getting started')).toBeTruthy();
    expect(screen.getByText('4 of 8 done')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Take the tour/ }));
    expect(h.start).toHaveBeenCalled();
  });

  it("shows You're all set and dismisses through the database", () => {
    h.input = { base: { c: full, skills: 2, slots: 1, bids: 1, pushDevices: 0 }, payout: ack };
    renderCard();
    expect(screen.getByText("You're all set")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(h.save).toHaveBeenCalledWith(0, 'completed');
  });

  it('stays hidden after dismissal', () => {
    h.dismissed = { completed_at: '2026-10-01' };
    h.input = { base: { c: full, skills: 2, slots: 1, bids: 1, pushDevices: 0 }, payout: ack };
    renderCard();
    expect(screen.queryByText('Getting started')).toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ progress: null as any, onboarding: true, rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const b: any = {};
      b.select = () => b; b.eq = () => b;
      b.maybeSingle = () => Promise.resolve({ data: table === 'profiles' ? { onboarding_completed: h.onboarding } : h.progress, error: null });
      return b;
    },
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}));

import { ConsultantTourProvider, useConsultantTour, AUTO_START_DELAY_MS } from './ConsultantTour';

function StartButton() {
  const { start } = useConsultantTour();
  return <button type="button" onClick={start}>start</button>;
}

const renderAt = (path = '/consultant') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <ConsultantTourProvider><StartButton /></ConsultantTourProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { h.progress = null; h.onboarding = true; h.rpc.mockReset(); h.rpc.mockResolvedValue({ error: null }); });
afterEach(() => cleanup());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ConsultantTour', () => {
  it('auto-starts on the dashboard after onboarding', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy(), { timeout: AUTO_START_DELAY_MS + 1500 });
    expect(screen.getByText(/This 2-minute tour shows you where everything is/)).toBeTruthy();
  });

  it('does not auto-start when onboarding is not completed', async () => {
    h.onboarding = false;
    renderAt();
    await wait(AUTO_START_DELAY_MS + 200);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not auto-start when skipped before', async () => {
    h.progress = { tour_key: 'consultant-welcome', tour_version: 1, last_step: 2, completed_at: null, skipped_at: '2026-10-01' };
    renderAt();
    await wait(AUTO_START_DELAY_MS + 200);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resumes at the saved step and saves progress, then skip saves skipped', async () => {
    h.progress = { tour_key: 'consultant-welcome', tour_version: 1, last_step: 2, completed_at: null, skipped_at: null };
    renderAt();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy(), { timeout: AUTO_START_DELAY_MS + 1500 });
    expect(screen.getByText(/Step 3 of/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(h.rpc).toHaveBeenCalledWith('save_tour_progress', { _key: 'consultant-welcome', _version: 1, _last_step: 3, _status: 'in_progress' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.rpc).toHaveBeenLastCalledWith('save_tour_progress', { _key: 'consultant-welcome', _version: 1, _last_step: 3, _status: 'skipped' });
  });

  it('start() resets and opens at step 0', async () => {
    h.onboarding = false;
    renderAt();
    fireEvent.click(screen.getByText('start'));
    expect(h.rpc).toHaveBeenCalledWith('reset_tour_progress', { _key: 'consultant-welcome' });
    expect(screen.getByText(/Step 1 of/)).toBeTruthy();
  });
});

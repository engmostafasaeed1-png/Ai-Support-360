import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InterviewsPage from './InterviewsPage';
const state = vi.hoisted(() => ({ pending: null as { id: string } | null, fail: false, insert: vi.fn(), ready: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: state.ready }) }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/components/consultant/AIInterviewFlow', () => ({ default: ({ interviewId, onComplete }: { interviewId: string; onComplete: () => void }) => <div>Assessment {interviewId}<button onClick={onComplete}>Complete assessment</button></div> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  from: (table: string) => {
    let inserting = false;
    const result = () => ({ data: table === 'consultants' ? { id: 'consultant-1' } : inserting ? { id: 'new-session' } : state.pending, error: state.fail ? new Error('Unavailable') : null });
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit']) chain[method] = () => chain;
    chain.insert = (payload: unknown) => { inserting = true; state.insert(payload); return chain; };
    chain.maybeSingle = async () => result(); chain.single = async () => result();
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  },
} }));
function mount(path = '/consultant/interviews?start=1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><InterviewsPage /></MemoryRouter></QueryClientProvider>);
  return client;
}
describe('profile interview start intent', () => {
  beforeEach(() => { cleanup(); state.pending = null; state.fail = false; state.ready = true; state.insert.mockClear(); });
  it('starts a real pending AI assessment from the dialog intent', async () => {
    mount();
    await screen.findByText('Assessment new-session');
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.insert).toHaveBeenCalledWith({ consultant_id: 'consultant-1', interview_type: 'ai', status: 'pending', interview_style: 'standard' });
  });
  it('resumes an existing self-started assessment without another insert', async () => {
    state.pending = { id: 'paused-session' }; mount();
    await screen.findByText('Assessment paused-session');
    expect(state.insert).not.toHaveBeenCalled();
  });
  it('does not start before the session is ready', () => {
    state.ready = false; mount(); expect(state.insert).not.toHaveBeenCalled();
  });
  it('shows a failure and lets the consultant retry', async () => {
    state.fail = true; mount(); await screen.findByRole('alert');
    state.fail = false; fireEvent.click(screen.getByRole('button', { name: 'Start AI Interview' }));
    await screen.findByText('Assessment new-session');
  });
  it('refreshes persisted profile data on completion', async () => {
    const client = mount(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    await screen.findByText('Assessment new-session');
    fireEvent.click(screen.getByRole('button', { name: 'Complete assessment' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['consultant-profile'] }));
  });
});
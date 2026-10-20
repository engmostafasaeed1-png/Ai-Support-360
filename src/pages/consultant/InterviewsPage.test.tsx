import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InterviewsPage from './InterviewsPage';
import { resetStartErrorLog } from '@/lib/interviewStart';

const state = vi.hoisted(() => ({
  open: [] as { id: string; status: string; created_at: string; interview_style?: string }[],
  fail: false, insert: vi.fn(), ready: true, block: null as null | string,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: state.ready, ready: true }) }));
vi.mock('@/hooks/useInterviewEligibility', () => ({
  INTERVIEW_ELIGIBILITY_KEY: ['interview-eligibility'],
  useInterviewEligibility: () => ({ block: state.ready ? state.block : 'signed_out', data: { consultantId: 'consultant-1', displayName: 'A', hasSapRole: true, interviewDone: false }, isError: false, refetch: () => undefined }),
}));
vi.mock('@/lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/components/consultant/InterviewPreflight', () => ({ default: ({ onContinue }: { onContinue: (o: { textOnly: boolean }) => void }) => <button onClick={() => onContinue({ textOnly: true })}>Continue text-only</button> }));
vi.mock('@/components/consultant/AIInterviewFlow', () => ({ default: ({ interviewId, onComplete, textOnly }: { interviewId: string; onComplete: () => void; textOnly?: boolean }) => <div>Assessment {interviewId}{textOnly ? ' typed' : ''}<button onClick={onComplete}>Complete assessment</button></div> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  from: (table: string) => {
    let inserting = false;
    const err = () => (state.fail ? { message: 'upstream unavailable' } : null);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'neq', 'order']) chain[method] = () => chain;
    chain.insert = (payload: unknown) => { inserting = true; state.insert(payload); return chain; };
    chain.limit = async () => ({ data: state.open, error: err() });
    chain.maybeSingle = async () => ({ data: table === 'consultants' ? { id: 'consultant-1' } : null, error: null });
    chain.single = async () => ({ data: inserting ? { id: 'new-session' } : null, error: err() });
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  },
} }));

function mount(path = '/consultant/interviews?start=1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><InterviewsPage /></MemoryRouter></QueryClientProvider>);
  return client;
}
async function passPreflight() { fireEvent.click(await screen.findByRole('button', { name: 'Continue text-only' })); }

describe('AI interview start', () => {
  beforeEach(() => { cleanup(); state.open = []; state.fail = false; state.ready = true; state.block = null; state.insert.mockClear(); resetStartErrorLog(); });

  it('creates one AI session, then runs the preflight before the interview', async () => {
    mount();
    await passPreflight();
    await screen.findByText('Assessment new-session typed');
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.insert).toHaveBeenCalledWith({ consultant_id: 'consultant-1', interview_type: 'ai', status: 'pending', interview_style: 'standard' });
  });

  it('resumes a pending session the consultant requested themselves instead of creating a duplicate', async () => {
    state.open = [{ id: 'self-requested', status: 'pending', created_at: new Date().toISOString(), interview_style: 'standard' }];
    mount();
    await passPreflight();
    await screen.findByText('Assessment self-requested typed');
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('reuses a pending session older than 24 hours instead of adding another', async () => {
    state.open = [{ id: 'old-pending', status: 'pending', created_at: new Date(Date.now() - 3 * 86400000).toISOString() }];
    mount();
    await passPreflight();
    await screen.findByText('Assessment old-pending typed');
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('does not start before the session is ready and says why', async () => {
    state.ready = false; mount();
    expect(await screen.findByText('Please sign in again to start the AI interview.')).toBeTruthy();
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('shows the missing SAP role with its fix instead of a silently dimmed button', async () => {
    state.block = 'missing_role'; mount();
    expect(await screen.findByText('Add your SAP role first.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add my SAP role' }).getAttribute('href')).toBe('/consultant/profile#expertise');
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('shows a service error with Retry, and Retry starts the interview', async () => {
    state.fail = true; mount();
    expect((await screen.findByRole('alert')).textContent).toContain('AI service temporarily unavailable - try again.');
    state.fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await passPreflight();
    await screen.findByText('Assessment new-session typed');
  });

  it('refreshes persisted profile data on completion', async () => {
    const client = mount(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    await passPreflight();
    await screen.findByText('Assessment new-session typed');
    fireEvent.click(screen.getByRole('button', { name: 'Complete assessment' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['consultant-profile'] }));
  });
});

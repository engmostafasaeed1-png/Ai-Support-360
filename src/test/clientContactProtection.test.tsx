/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// A fake database: every call is written down (table, method, arguments).
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));
vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const rows = () => db.tables[table];
    const b: any = {};
    for (const m of ['select', 'in', 'order', 'eq', 'limit', 'gte', 'lte', 'lt', 'gt', 'neq', 'is', 'or', 'not', 'range']) {
      b[m] = (...args: unknown[]) => { db.calls.push({ table, method: m, args }); return b; };
    }
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows()) ? (rows() as any[])[0] ?? null : rows() ?? null, error: null });
    b.single = b.maybeSingle;
    b.then = (ok: any, ko: any) => Promise.resolve({ data: rows() ?? [], error: null, count: 0 }).then(ok, ko);
    return b;
  };
  const channel: any = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'client-1' } } }), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      from: (t: string) => chain(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'en' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/consultant/InterviewTranscript', () => ({ default: () => null }));
vi.mock('@/components/ShareMenu', () => ({ default: () => null }));
vi.mock('@/components/client/ConsultantLocationMap', () => ({ default: () => null }));
vi.mock('@/components/client/ConsultantMap', () => ({ default: () => null }));
vi.mock('@/components/client/WriteReviewDialog', () => ({ default: () => null }));

const LIVE = {
  id: 'c1', name: 'Jane Doe', specialty: 'SAP FI', skills: ['SAP FI'], rating: 4.8, reviews: 3, rate: 100, avatar: 'JD', available: true, status: 'available',
  badges: ['verified'], lat: 30, lng: 31, city: 'Cairo', country: 'Egypt', place: 'Cairo, Egypt', industries: [], linkedinVerified: true, credlyVerified: true,
  linkedin_state: 'checked', credly_state: 'checked', languages: ['en'], response_time_minutes: 10, verification_status: 'verified', hours: [],
};
vi.mock('@/hooks/useRealtimeConsultants', () => ({ useRealtimeConsultants: () => ({ consultants: [LIVE], realtimeConnected: true, isLoading: false }) }));

import ConsultantsPage from '@/pages/client/ConsultantsPage';
import ConsultantProfilePage from '@/pages/client/ConsultantProfilePage';
import ScheduleMeetingDialog from '@/components/client/ScheduleMeetingDialog';

function show(ui: React.ReactElement, path = '/', route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={ui} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const externalAnchors = () => Array.from(document.querySelectorAll('a')).filter(a => /linkedin\.com|credly\.com/.test(a.getAttribute('href') || ''));
const bookButtons = () => screen.queryAllByRole('button').filter(b => /\bbook\b/i.test(b.textContent || ''));

beforeEach(() => {
  db.calls.length = 0;
  db.tables = {
    consultants: { id: 'c1', user_id: 'u-c1', bio: 'SAP FI', hourly_rate: 100, currency: 'USD', languages: ['en'], industries: [], response_time_minutes: 10, availability_status: 'available', rating: 4.8, total_reviews: 3, verification_status: 'verified', ai_skills_score: 80, city: 'Cairo', country: 'Egypt', latitude: 30, longitude: 31, linkedin_checked_at: '2026-10-01T00:00:00Z', credly_checked_at: '2026-10-01T00:00:00Z' },
    profile_directory: { user_id: 'u-c1', display_name: 'Jane Doe', avatar_url: null },
  };
});
afterEach(() => cleanup());

describe('client directory', () => {
  it('shows LinkedIn and Credly only as status badges, never as a link, and has no Book button', async () => {
    show(<ConsultantsPage />);
    await screen.findByText('Jane Doe');
    expect(externalAnchors()).toHaveLength(0);
    expect(bookButtons()).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Open a request' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sessions are arranged inside a request, so everything stays protected in the portal.').length).toBeGreaterThan(0);
  });
});

describe('client consultant profile', () => {
  it('keeps identity below the banner, shows credibility and five stars with no reviews, and opens Reviews from the rating tile', async () => {
    db.tables.consultants = { ...(db.tables.consultants as Record<string, unknown>), rating: 0, total_reviews: 0, bio: '' };
    show(<ConsultantProfilePage />, '/client/consultants/c1', '/client/consultants/:id');
    const name = await screen.findByRole('heading', { level: 1, name: 'Jane Doe' });
    expect(screen.getByTestId('profile-hero')).toContainElement(name);
    expect(screen.getByTestId('profile-banner')).not.toContainElement(name);
    const tile = screen.getByTestId('rating-tile');
    expect(within(tile).getAllByTestId('rating-star')).toHaveLength(5);
    expect(within(tile).getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.getByTestId('credibility-pill')).toBeInTheDocument();
    expect(screen.getByText('JD')).toBeInTheDocument();
    fireEvent.click(tile);
    expect(screen.getByRole('tab', { name: 'consultant_profile.reviews' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-state', 'active');
  });

  it('shows the locked card when the view returns no row, with no links and no Book button', async () => {
    show(<ConsultantProfilePage />, '/client/consultants/c1', '/client/consultants/:id');
    expect(await screen.findByTestId('contact-links-locked')).toBeTruthy();
    expect(screen.getByText('Contact links are shown once this consultant is assigned to one of your requests.')).toBeTruthy();
    expect(externalAnchors()).toHaveLength(0);
    expect(bookButtons()).toHaveLength(0);
    const consultantSelects = db.calls.filter(c => c.table === 'consultants' && c.method === 'select').map(c => String(c.args[0]));
    for (const s of consultantSelects) expect(s).not.toMatch(/\*|linkedin_url|credly_username|github_url|personal_website|profile_video_url/);
  });

  it('shows the contact links when the view returns a row', async () => {
    db.tables.consultant_contact_links = { linkedin_url: 'https://www.linkedin.com/in/jane-doe', github_url: null, personal_website: null, profile_video_url: null, credly_username: 'jane-doe' };
    show(<ConsultantProfilePage />, '/client/consultants/c1', '/client/consultants/:id');
    const card = await screen.findByTestId('contact-links-card');
    expect(card.textContent).toContain('Shared because this consultant is assigned to your request.');
    const hrefs = Array.from(card.querySelectorAll('a')).map(a => [a.getAttribute('href'), a.getAttribute('rel'), a.getAttribute('target')]);
    expect(hrefs).toContainEqual(['https://www.linkedin.com/in/jane-doe', 'noopener noreferrer', '_blank']);
    expect(hrefs).toContainEqual(['https://www.credly.com/users/jane-doe', 'noopener noreferrer', '_blank']);
  });
});

describe('ScheduleMeetingDialog', () => {
  it('never asks for the list of all consultants and offers no "All Consultants" choice', async () => {
    db.tables.ticket_assignments = [];
    db.tables.consultants = [{ id: 'c1', user_id: 'u-c1' }];
    db.tables.profile_directory = [{ user_id: 'u-c1', display_name: 'Jane Doe', avatar_url: null }];
    show(<ScheduleMeetingDialog open onOpenChange={() => {}} ticketId="t1" ticketTitle="Ticket" clientId="client-1" consultantId="c1" />);
    await waitFor(() => expect(db.calls.some(c => c.table === 'consultants' && c.method === 'in')).toBe(true));
    expect(screen.queryByText('All Consultants')).toBeNull();
    expect(db.calls.some(c => c.table === 'consultants' && c.method === 'eq' && c.args[0] === 'verification_status')).toBe(false);
    for (const c of db.calls.filter(c => c.table === 'consultants' && c.method === 'in')) expect(c.args).toEqual(['id', ['c1']]);
  });
});

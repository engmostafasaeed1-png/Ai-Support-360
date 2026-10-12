import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A small fake of the database: every table answers with the rows that the test put in it, and every update is written down.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  updates: [] as Array<{ table: string; payload: unknown; eq: unknown[] }>,
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const result = () => db.tables[table] ?? { data: [], error: null };
    const b: any = {};
    for (const method of ['select', 'in', 'order', 'eq', 'limit']) b[method] = () => b;
    b.maybeSingle = () => Promise.resolve(result());
    b.update = (payload: unknown) => {
      const record = { table, payload, eq: [] as unknown[] };
      db.updates.push(record);
      return {
        eq: (...args: unknown[]) => {
          record.eq = args;
          return Promise.resolve({ error: null });
        },
      };
    };
    b.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return { supabase: { from: (table: string) => chain(table) } };
});
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/data/adminMockData', () => ({ pendingConsultants: [] }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/consultant/ReinterviewDialog', () => ({ default: () => null }));
vi.mock('@/components/admin/ScheduleLiveInterviewDialog', () => ({ default: () => null }));
vi.mock('@/components/consultant/InterviewHistory', () => ({ default: () => null }));
vi.mock('@/components/admin/ConsultantVerificationAuditLog', () => ({ default: () => null }));

import { toast } from 'sonner';
import ConsultantApprovalsPage from './ConsultantApprovalsPage';

const row = (id: string, userId: string, status: string, patch: Record<string, unknown> = {}) => ({
  id,
  user_id: userId,
  bio: 'SAP FI consultant',
  hourly_rate: 100,
  currency: 'USD',
  languages: ['en'],
  industries: [],
  ai_skills_score: 80,
  created_at: '2026-10-01T10:00:00Z',
  verification_status: status,
  city: 'Cairo',
  country: 'Egypt',
  linkedin_url: 'https://www.linkedin.com/in/jane-doe',
  linkedin_checked_at: null,
  credly_username: null,
  credly_checked_at: null,
  github_url: null,
  personal_website: null,
  consultant_skills: [{ sap_module: 'SAP FI/CO', proficiency_level: 4 }],
  certifications: [{ id: `k-${id}`, name: 'ITIL Foundation', issuer: 'Axelos', issue_date: null, expiry_date: null, document_url: null, verified: false }],
  ...patch,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConsultantApprovalsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.updates.length = 0;
  db.tables.consultants = { data: [row('c1', 'u1', 'pending'), row('c2', 'u2', 'verified', { city: null, country: null })], error: null };
  db.tables.consultant_contact_links = { data: [{ consultant_id: 'c1', linkedin_url: 'https://www.linkedin.com/in/jane-doe', github_url: null, personal_website: null, credly_username: null }, { consultant_id: 'c2', linkedin_url: 'https://www.linkedin.com/in/jane-doe', github_url: null, personal_website: null, credly_username: null }], error: null };
  db.tables.profiles = { data: [{ user_id: 'u1', display_name: 'Jane Doe' }, { user_id: 'u2', display_name: 'Omar Ali' }], error: null };
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('ConsultantApprovalsPage', () => {
  it('shows the groups of consultants with the number in each', async () => {
    show();
    await screen.findByText('Jane Doe');
    for (const name of ['To review (1)', 'On hold (0)', 'Verified (1)', 'Rejected (0)', 'Suspended (0)']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'To review (1)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the status and the place of every consultant', async () => {
    show();
    await screen.findByText('Jane Doe');
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('Cairo, Egypt')).toBeTruthy();
  });

  it('opens the links and the certificates of a consultant', async () => {
    show();
    fireEvent.click(await screen.findByText('Jane Doe'));
    expect(screen.getByTestId('trust-panel').textContent).toContain('Cairo, Egypt');
    expect(screen.getByLabelText('Open the LinkedIn page in a new tab').getAttribute('href')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(screen.getByTestId('certificate-review').textContent).toContain('ITIL Foundation');
  });

  it('offers the decisions that fit the status of the consultant', async () => {
    show();
    fireEvent.click(await screen.findByText('Jane Doe'));
    for (const name of ['Start review', 'Put on hold', 'Reject', 'Approve']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByText('Omar Ali'));
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('saves the status that was chosen and says so', async () => {
    show();
    fireEvent.click(await screen.findByText('Jane Doe'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Approve consultant')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason / notes (optional)'), { target: { value: 'Documents checked' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Consultant approved!'));
    expect(db.updates[0]).toEqual({ table: 'consultants', payload: { verification_status: 'verified' }, eq: ['id', 'c1'] });
  });

  it('suspends a verified consultant', async () => {
    show();
    fireEvent.click(await screen.findByText('Omar Ali'));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Suspend consultant')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Consultant suspended.'));
    expect(db.updates[0].payload).toEqual({ verification_status: 'suspended' });
    expect(db.updates[0].eq).toEqual(['id', 'c2']);
  });
});

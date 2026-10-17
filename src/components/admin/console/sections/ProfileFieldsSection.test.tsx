import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const KEYS = ['display_name', 'avatar', 'phone', 'bio', 'hourly_rate', 'timezone', 'languages', 'language_levels', 'nationality',
  'country', 'city', 'work_modes', 'working_week', 'linkedin_url', 'credly_username', 'github_url', 'personal_website', 'profile_video_url',
  'sap_role', 'seniority_level', 'total_sap_years', 'sap_roles', 'sap_technologies', 'industries', 'customer_segments', 'vertical_solutions',
  'localization_countries', 'localization_solutions', 'deployment_experience', 'project_types', 'project_scale',
  'skills', 'certifications', 'work_history', 'education', 'projects', 'availability', 'cv', 'ai_interview', 'bank_details'];
const sectionOf = (i: number) => i < 9 ? 'Basics' : i < 13 ? 'Location' : i < 18 ? 'Links' : i < 31 ? 'Experience' : i < 38 ? 'Records' : 'Verification';
const RULES = KEYS.map((k, i) => ({ field_key: k, section: sectionOf(i), label: `Label ${k}`, mode: k === 'bio' ? 'required' : 'optional', default_mode: k === 'bio' ? 'required' : 'optional', sort_order: i }));

const rpc = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, in: () => Promise.resolve({ data: [{ user_id: 'u1', display_name: 'Admin One' }], error: null }),
      order: () => (table === 'profile_field_rules' ? Promise.resolve({ data: RULES, error: null }) : chain),
      limit: () => Promise.resolve({ data: [{ id: 'l1', field_key: 'bio', old_mode: 'optional', new_mode: 'required', changed_by: 'u1', changed_at: '2026-10-01T10:00:00Z' }], error: null }),
      maybeSingle: () => Promise.resolve({ data: { enforce: false }, error: null }),
    };
    return chain;
  };
  return { supabase: { from, rpc } };
});

import ProfileFieldsSection, { changedRules } from './ProfileFieldsSection';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ProfileFieldsSection /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve(name === 'admin_incomplete_consultants'
    ? { data: [{ consultant_id: 'c1', display_name: 'Sara Ali', verification_status: 'verified', missing: ['bio', 'city'] }], error: null }
    : { data: null, error: null }));
});
afterEach(() => cleanup());

describe('ProfileFieldsSection', () => {
  it('opens the full profile from the incomplete consultant row', async () => {
    show(); await screen.findByText(/consultants are missing required fields/);
    fireEvent.click(screen.getByRole('button', { name: 'View who' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View full profile' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_consultant_full_profile', { _cid: 'c1' }));
  });
  it('renders the 40 fields grouped by section', async () => {
    show();
    await screen.findByTestId('rule-bank_details');
    expect(document.querySelectorAll('[data-testid^="rule-"]').length).toBe(40);
    for (const s of ['Basics', 'Location', 'Links', 'Experience', 'Records', 'Verification']) expect(screen.getByTestId(`section-${s}`)).toBeTruthy();
    expect(within(screen.getByTestId('section-Location')).getAllByText(/^Label /)).toHaveLength(4);
    expect(screen.getByText(/consultants are missing required fields/)).toBeTruthy();
  });

  it('saves only the changed rows', async () => {
    show();
    const row = await screen.findByTestId('rule-phone');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(row).getByRole('radio', { name: 'Required' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_profile_field_rules', { _rules: [{ field_key: 'phone', mode: 'required' }], _enforce: null }));
  });

  it('lists the consultants that would be hidden before the switch turns on', async () => {
    show();
    await screen.findByText(/consultants are missing required fields/);
    fireEvent.click(screen.getByRole('switch', { name: /Hide incomplete profiles/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sara Ali')).toBeTruthy();
    expect(within(dialog).getByText(/Label bio, Label city/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Turn on' })).toBeTruthy();
  });

  it('renders the change log tab', async () => {
    show();
    await screen.findByTestId('rule-bio');
    const tab = screen.getByRole('tab', { name: 'Change log' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByText('Admin One')).toBeTruthy();
  });

  it('changedRules keeps only real changes', () => {
    expect(changedRules(RULES as any, { bio: 'required', phone: 'hidden' })).toEqual([{ field_key: 'phone', mode: 'hidden' }]);
  });
});

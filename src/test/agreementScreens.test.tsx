/* eslint-disable @typescript-eslint/no-explicit-any */
// Smoke tests for the support agreement screens built on the owner requirements of Oct 25 (settings form with
// progress checklist, team confirmation, documents area). The database decides; these check what the screens show.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n/config';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, storage: { from: () => ({}) } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1', name: 'Acme' }, loading: false }) }));
vi.mock('@/hooks/useClientFavourites', () => ({ useClientFavourites: () => ({ favourites: new Map([['c2', {}]]), groups: [], blocked: new Set() }) }));
vi.mock('@/lib/sla/api', () => ({ fetchMyPolicies: async () => ({ policies: [] }), fetchPolicyVersion: async () => ({ body: null }) }));
vi.mock('@/lib/safeRpc', () => ({ safeRpc: async () => ({ data: 'M. S****', error: null }), isMissingRpc: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/consultant/NDASigningModal', () => ({ default: () => null }));

import AgreementRequestForm from '@/components/agreements/AgreementRequestForm';
import { TeamConfirmation } from '@/components/agreements/AgreementCrew';
import AgreementDocuments from '@/components/agreements/AgreementDocuments';
import { SA_DEFAULT_SETTINGS } from '@/lib/agreements/model';
import type { SaDetail } from '@/lib/agreements/api';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider></I18nextProvider>);
};
afterEach(cleanup);

const settings = { ...SA_DEFAULT_SETTINGS, enabled: true };

describe('agreement settings form', () => {
  it('shows all ten sections in the progress checklist and blocks publishing until the basics are filled', async () => {
    await i18n.changeLanguage('en');
    wrap(<AgreementRequestForm settings={settings} onSaved={() => undefined} onCancel={() => undefined} />);
    const nav = screen.getByRole('navigation', { name: 'Progress' });
    for (const s of ['Basics', 'Term', 'Rates', 'Commitment', 'SLA', 'Crew', 'Reporting', 'Escalation contacts', 'Documents', 'Review & accept']) {
      expect(nav).toHaveTextContent(s);
    }
    expect(screen.getByRole('button', { name: /Publish/ })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /Save draft/ }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Agreement name'), { target: { value: 'FI support' } });
    expect(screen.getByText(/unique in your company/)).toBeInTheDocument();
  });
  it('locks the name once the agreement is published', async () => {
    await i18n.changeLanguage('en');
    wrap(<AgreementRequestForm settings={settings} agreementId="a1" status="open" reference="SA-2026-000012" onSaved={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByLabelText('Agreement name')).toBeDisabled();
    expect(screen.getByText('SA-2026-000012')).toBeInTheDocument();
  });
});

const detail = (o: Partial<SaDetail> = {}): SaDetail => ({
  id: 'a1', name: 'FI support', reference: 'SA-2026-000012', status: 'agreed', role: 'client', request: {}, modules: ['FI'], deadline: null, invite_only: false, legal_draft: true,
  created_at: '2026-10-25', terms_public: {} as any, messages: [], events: [],
  terms: { nda_required: true, sla: { policy_id: null, version: null, summary: '' }, rate: { currency: 'USD' } } as any,
  confirmation: {
    ready: false,
    items: [{ key: 'terms', ok: true }, { key: 'crew', ok: false }, { key: 'nda', ok: false, needed: true }, { key: 'admin_review', ok: true, needed: false }, { key: 'start_date', ok: true, date: '2026-10-25' }],
    members: [
      { consultant_id: 'k', name: 'K. A****', role: 'lead', required: true, status: 'active', capacity_hours_per_week: 20, working_hours: {}, backup_for: null, accepted_at: '2026-10-25', sla_accepted_at: '2026-10-25', sla_version: 1, nda_ok: true, nda_signed_at: '2026-10-20' },
      { consultant_id: 'u', name: 'U. B****', role: 'functional', required: true, status: 'invited', capacity_hours_per_week: 10, working_hours: {}, backup_for: null, accepted_at: null, sla_accepted_at: null, sla_version: null, nda_ok: false, nda_signed_at: null },
    ],
  },
  ...o,
});

describe('team confirmation', () => {
  it('lists what still blocks the start and each member status; SLA starts only when the crew is confirmed', async () => {
    await i18n.changeLanguage('en');
    wrap(<TeamConfirmation a={detail()} lang="en" />);
    expect(screen.getByText(/SLA starts when the crew is confirmed/)).toBeInTheDocument();
    expect(screen.getByText('Every required crew member accepted the place and the SLA')).toBeInTheDocument();
    expect(screen.getByText('K. A****')).toBeInTheDocument();
    expect(screen.getByText('U. B****')).toBeInTheDocument();
    expect(screen.getByText('Not signed yet')).toBeInTheDocument();
  });
});

describe('agreement documents', () => {
  it('a consultant without an accepted place and NDA sees that files are locked; the no-secrets warning is always shown', async () => {
    await i18n.changeLanguage('en');
    wrap(<AgreementDocuments a={detail({ role: 'team', documents_locked: true, documents: null, can_upload: false })} settings={settings} />);
    expect(screen.getByText(/Documents open after your place is accepted/)).toBeInTheDocument();
    expect(screen.getByText(/Never upload passwords/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload a file/ })).toBeNull();
  });
  it('the client sees the files with their versions and can upload', async () => {
    await i18n.changeLanguage('en');
    wrap(<AgreementDocuments a={detail({ documents_locked: false, can_upload: true, downloads: [], documents: [{ id: 'd1', kind: 'sow', title: 'Statement of work', current_version: 2, archived_at: null, created_at: '2026-10-25',
      versions: [{ version: 2, file_name: 'SOW v2.pdf', mime_type: 'application/pdf', size_bytes: 2000, note: '', by_role: 'lead', by: 'K. A****', at: '2026-10-25T10:00:00Z' }, { version: 1, file_name: 'SOW v1.pdf', mime_type: 'application/pdf', size_bytes: 1000, note: '', by_role: 'client', by: 'Olivia', at: '2026-10-24T10:00:00Z' }] }] })} settings={settings} />);
    expect(screen.getAllByText('Statement of work').length).toBeGreaterThan(0);
    expect(screen.getByText('Version history (2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload a file/ })).toBeEnabled();
  });
});

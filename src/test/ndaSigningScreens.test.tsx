// Screen checks for strict NDA signing: the Sign button stays disabled with inline messages until every item is
// valid, and the NDA box shows the right state for signer / other party / legacy NDAs. The database decides; these
// check what the screens show.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n/config';
import type { NdaStatus } from '../../supabase/functions/_shared/ndaSignature';

let status: NdaStatus | null = null;
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, storage: { from: () => ({}) } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useNdaSigning', () => ({
  useNdaStatus: () => ({ data: status, isLoading: false }),
  useNdaSigningSettings: () => ({ data: null, isLoading: false }),
  useRefreshNda: () => () => undefined,
}));

import NdaSignForm from '@/components/nda/NdaSignForm';
import NdaStatusCard from '@/components/nda/NdaStatusCard';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider></I18nextProvider>);
};
afterEach(() => { cleanup(); status = null; });

const base = (over: Partial<NdaStatus>): NdaStatus => ({
  available: true, nda_id: 'n1', consultant_id: 'c1', client_id: 'u1', revoked_at: null, document_hash: 'h', my_party: 'consultant',
  consultant: { signed_at: null, legacy: false, evidence: null }, client: { signed_at: null, legacy: false, evidence: null },
  last_reminder_at: null, reminder_hours: 24, ...over,
});

describe('NDA sign form', () => {
  it('keeps Sign disabled and lists what is missing', async () => {
    await i18n.changeLanguage('en');
    wrap(<NdaSignForm party="client" action="sign" ndaId="n1" defaultName="Omar" allowTyped={false} onDone={() => undefined} />);
    const sign = screen.getByRole('button', { name: /Sign NDA/ });
    expect(sign).toBeDisabled();
    expect(screen.getByText(/Still needed before you can sign/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Full legal name/)).toHaveValue('Omar');
    expect(screen.getByLabelText(/Your job title/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy-policy');
    expect(screen.queryByRole('tab', { name: /Type my signature/ })).toBeNull();
  });
  it('shows the masked form of the ID number while typing', async () => {
    await i18n.changeLanguage('en');
    wrap(<NdaSignForm party="consultant" action="sign" ndaId="n1" allowTyped={false} onDone={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Document number/), { target: { value: 'A12345789' } });
    expect(screen.getByText(/A1\*\*\*\*789/)).toBeInTheDocument();
  });
});

describe('NDA box', () => {
  it('signer sees the confirmation, the download and the reminder button', async () => {
    await i18n.changeLanguage('en');
    status = base({ consultant: { signed_at: '2026-10-25T08:00:00Z', legacy: false, evidence: null } });
    wrap(<NdaStatusCard ndaId="n1" clientName="Acme" />);
    expect(screen.getByText(/You signed on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View \/ download my signed NDA/ })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the client/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a reminder/ })).toBeEnabled();
  });
  it('the party who still has to sign gets a prominent Review and sign', async () => {
    await i18n.changeLanguage('en');
    status = base({ my_party: 'client', consultant: { signed_at: '2026-10-25T08:00:00Z', legacy: false, evidence: null } });
    const onReview = vi.fn();
    wrap(<NdaStatusCard ndaId="n1" consultantName="M. S****" onReviewAndSign={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: /Review and sign/ }));
    expect(onReview).toHaveBeenCalled();
  });
  it('legacy signed NDAs stay signed and offer the optional details action', async () => {
    await i18n.changeLanguage('en');
    status = base({ consultant: { signed_at: '2026-01-01T00:00:00Z', legacy: true, evidence: null }, client: { signed_at: '2026-01-02T00:00:00Z', legacy: true, evidence: null } });
    wrap(<NdaStatusCard ndaId="n1" />);
    expect(screen.getByText('Fully signed')).toBeInTheDocument();
    expect(screen.getAllByText(/legacy signature, no ID collected/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Download the fully signed NDA/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add my signature details/ }).length).toBe(1);
  });
  it('shows nothing new when the strict signing update is not installed', async () => {
    status = { ...base({}), available: false };
    wrap(<NdaStatusCard ndaId="n1" fallback={<p>legacy box</p>} />);
    expect(screen.getByText('legacy box')).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock('@/hooks/useAssignmentPolicy', async () => {
  const m = await import('../../../supabase/functions/_shared/assignmentPolicy');
  return { useAssignmentPolicy: () => m.POLICY_DEFAULTS, extendAssignmentRequest: vi.fn() };
});
vi.mock('@/components/consultant/ConsultantLocation', () => ({ default: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'client-1' } } }) },
    from: (table: string) => {
      const b: any = {};
      b.select = () => b; b.eq = () => b; b.in = () => b;
      b.order = () => Promise.resolve({ data: h.rows, error: null });
      b.then = (res: any) => res({ data: table === 'consultants' ? [{ id: 'c1', user_id: 'u1' }] : [{ user_id: 'u1', display_name: 'Sara' }], error: null });
      return b;
    },
  },
}));

import TicketMatchRequests from './TicketMatchRequests';

const renderCard = (props: Record<string, unknown> = {}) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><TicketMatchRequests ticketId="t1" clientId="client-1" {...props} /></MemoryRouter>
  </QueryClientProvider>,
);
afterEach(() => cleanup());

const row = (patch: Record<string, unknown>) => ({ id: 'r1', consultant_id: 'c1', status: 'pending', created_at: new Date().toISOString(), ...patch });

describe('TicketMatchRequests (client)', () => {
  it('a waiting request shows who it was sent to and the time left', async () => {
    h.rows = [row({ response_due_at: new Date(Date.now() + 3 * 3_600_000).toISOString() })];
    renderCard();
    expect(await screen.findByText(/Request sent to Sara, waiting for reply\./)).toBeTruthy();
    expect(screen.getByText(/h \d+ min left/)).toBeTruthy();
  });

  it('No response offers Invite another, Open for bids and Wait longer once', async () => {
    h.rows = [row({ status: 'expired' })];
    const invite = vi.fn(); const bids = vi.fn();
    renderCard({ onInviteAnother: invite, onOpenBids: bids });
    expect(await screen.findByText('Sara did not respond within the time limit.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Invite another/ }));
    fireEvent.click(screen.getByRole('button', { name: /Open for bids/ }));
    expect(invite).toHaveBeenCalledTimes(1);
    expect(bids).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Wait longer \(24 hours, once\)/ })).toBeTruthy();
  });

  it('no Wait longer after the one extension', async () => {
    h.rows = [row({ status: 'expired', extended_at: new Date().toISOString() })];
    renderCard({ onInviteAnother: vi.fn(), onOpenBids: vi.fn() });
    await screen.findByText('Sara did not respond within the time limit.');
    expect(screen.queryByRole('button', { name: /Wait longer/ })).toBeNull();
  });
});

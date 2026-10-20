import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const notices = [
  { id: 'n1', kind: 'warning_1', event_id: 'e1', count_30d: 1, warnings_total: 2, created_at: '2026-10-20T10:00:00Z' },
  { id: 'n2', kind: 'warning_2', event_id: 'e2', count_30d: 2, warnings_total: 2, created_at: '2026-10-20T11:00:00Z' },
];
const ack = vi.fn(async (_id: string) => {});
vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: true }) }));
vi.mock('@/hooks/useResponsiveness', () => ({
  useResponsivenessNotices: () => ({ data: notices.filter((n) => !ack.mock.calls.some((c) => (c as unknown[])[0] === n.id)) }),
  ackResponsivenessNotice: (id: string) => ack(id),
}));

import ResponsivenessNoticePopup from './ResponsivenessNoticePopup';

describe('responsiveness popup', () => {
  it('shows one notice at a time until it is acknowledged, then the next', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ResponsivenessNoticePopup /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole('dialog')).toHaveTextContent('Friendly notice 1 of 2: a request was not answered in time');
    expect(screen.getByRole('button', { name: 'Dispute' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }));
    await waitFor(() => expect(ack).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Friendly notice 2 of 2: a request was not answered in time'));
  });
});

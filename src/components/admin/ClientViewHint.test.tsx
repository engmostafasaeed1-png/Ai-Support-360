import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import ClientViewHint from './ClientViewHint';

const at = (path: string) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><span>Mostafa Saeed</span><ClientViewHint id="c1" /></MemoryRouter></QueryClientProvider>,
);

describe('ClientViewHint (admin screens only)', () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: [{ consultant_id: 'c1', user_id: 'u1', client_view: 'M. S****' }], error: null });
  });
  it('shows the neutral client view next to the full name on admin pages', async () => {
    at('/admin/users');
    expect(await screen.findByTestId('client-view-hint')).toHaveTextContent('Visible to clients as: M. S****');
    expect(screen.getByText('Mostafa Saeed')).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith('consultant_client_view_names', { _ids: ['c1'] });
  });
  it('never shows or asks outside admin pages', async () => {
    at('/client/tickets/t1');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('client-view-hint')).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('stays hidden until the database part is installed', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    at('/admin/users');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('client-view-hint')).not.toBeInTheDocument();
  });
});

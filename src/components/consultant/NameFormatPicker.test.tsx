import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ installed: true, update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: () => Promise.resolve(h.installed ? { data: { enabled: true }, error: null } : { data: null, error: { message: 'missing' } }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === 'profiles' ? { display_name: 'Mostafa Saeed' } : { name_format: 'masked' } }) }) }),
      update: h.update,
    }),
  },
}));
import NameFormatPicker from './NameFormatPicker';

const wrap = () => render(<QueryClientProvider client={new QueryClient()}><NameFormatPicker consultantId="c1" /></QueryClientProvider>);

describe('NameFormatPicker', () => {
  beforeEach(() => { h.installed = true; h.update.mockClear(); });
  it('stays hidden until the database part is installed', async () => {
    h.installed = false;
    const { container } = wrap();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
  it('previews the four formats of the own name and saves the choice', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('name-format-sample-masked')).toHaveTextContent('M. S****'));
    expect(screen.getByTestId('name-format-sample-initial_family')).toHaveTextContent('M. Saeed');
    expect(screen.getByTestId('name-format-sample-initials')).toHaveTextContent('M.S.');
    expect(screen.getByTestId('name-format-sample-full')).toHaveTextContent('Mostafa Saeed');
    expect(screen.getByTestId('name-format-preview')).toHaveTextContent('Visible to clients as: M. S****');
    fireEvent.click(screen.getByRole('radio', { name: /M\.S\./ }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ name_format: 'initials' }));
    expect(screen.getByTestId('name-format-preview')).toHaveTextContent('Visible to clients as: M.S.');
  });
});
